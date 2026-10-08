import type { Logger } from "winston";
import { z } from "zod";

import { translate } from "../../i18n/index";
import { readJson } from "../../net/http-client";
import {
  BotHomeRefusedError,
  BotNotProvisionedError,
  BotNotReadyError,
  BotOwnerNotServedError,
  BotRecoveryNeededError,
  BotsUpstreamError,
} from "./errors";
import { myBotResponseSchema } from "./schema";
import type { BotsSettings, HarnessSettings, MyBot } from "./types";

const PROVISIONING_PATH = "/v1/provisioning/assistants";
/** The endpoints as the logs name them: the owner never appears in a log. */
const PROVISION_ENDPOINT = `PUT ${PROVISIONING_PATH}/{owner}`;
const READ_ENDPOINT = `GET ${PROVISIONING_PATH}/{owner}`;
const HOME_ENDPOINT = `PUT ${PROVISIONING_PATH}/{owner}/home`;
const RECOVER_ENDPOINT = `POST ${PROVISIONING_PATH}/{owner}/recover`;
const TOKEN_ENDPOINT = "token";
/** Between two calls while the harness prepares a bot, unless it says otherwise. */
const READY_POLL_MS = 1000;
/** A token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 30000;

/** A client id or secret as RFC 6749 §2.3.1 wants it before Basic: application/x-www-form-urlencoded. */
const formEncode = (value: string): string =>
  new URLSearchParams({
    value,
  })
    .toString()
    .slice("value=".length);

/** The 409 of `/home` for a room someone else is in: retrying does not help. */
const NOT_A_DIRECT_ROOM = "not a direct room";
/** The 409 of provisioning for an identity only its owner's recovery brings back. */
const RECOVERY_NEEDED = "recovery_needed";
/** The 404 of a read for an owner without a bot, or whose bot was deleted. */
const NO_ASSISTANT = "no assistant";
const refusalSchema = z.object({
  error: z.string(),
});

/** The `error` the harness names in its answer, if it names one; the body stays readable. */
const errorOf = async (response: Response): Promise<string | undefined> =>
  (await readJson(response.clone(), refusalSchema))?.error;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

/** What a fetch cut by its AbortSignal.timeout throws. */
const isTimeout = (err: unknown): boolean =>
  err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

/** Why a call failed, by the error's code or name: its message may carry the URL, and so the owner. */
const reasonOf = (err: unknown): string => {
  if (!(err instanceof Error)) return translate("log.net.request_failed");
  const code = (
    err as {
      code?: unknown;
    }
  ).code;
  return typeof code === "string" ? code : err.name;
};

/**
 * The assistants served by the agent harness of the platform, which owns them
 * as its application service: ToM asks it for the bot of a user, and answers
 * the client exactly as the Hermes backend does. ToM calls it with a token of
 * its own OIDC client (client credentials), never with the user's. Each route
 * answers within `ready_timeout_ms` of its start, token, calls and waits
 * included, so the client never waits past it.
 */
export class HarnessBotsService {
  #config: BotsSettings;
  #harness: HarnessSettings;
  #baseUrl: string;
  #log: Logger;
  #token: {
    value: string;
    expiresAt: number;
  } | null = null;
  /** The token request in flight, which the calls that need a token meanwhile share. */
  #tokenRequest: Promise<string> | null = null;

  constructor(config: BotsSettings, harness: HarnessSettings, logger: Logger) {
    this.#config = config;
    this.#harness = harness;
    this.#baseUrl = harness.url.replace(/\/+$/, "");
    this.#log = logger;
  }

  /**
   * The bot of the owner: the harness creates it at the first call and prepares
   * its encryption identity, answering 503 meanwhile; the call is idempotent, so
   * ToM asks again until the harness has it or `ready_timeout_ms` has passed.
   */
  async provision(ownerId: string, _ownerToken: string, timezone?: string): Promise<MyBot> {
    const deadline = Date.now() + this.#config.ready_timeout_ms;
    const path = `${PROVISIONING_PATH}/${encodeURIComponent(ownerId)}`;
    const body = timezone
      ? {
          timezone,
        }
      : {};
    return this.#botOf(
      PROVISION_ENDPOINT,
      await this.#onceReady(() => this.#put(PROVISION_ENDPOINT, path, body, deadline), deadline),
    );
  }

  /**
   * The bot of the owner as the harness has it, never made: none when the
   * harness says the owner has no bot, or deleted it. While the harness prepares
   * the identity of a bot it has, ToM asks again, as for `provision`.
   */
  async find(ownerId: string, _ownerToken: string): Promise<MyBot | null> {
    const deadline = Date.now() + this.#config.ready_timeout_ms;
    const path = `${PROVISIONING_PATH}/${encodeURIComponent(ownerId)}`;
    const response = await this.#onceReady(() => this.#send("GET", READ_ENDPOINT, path, null, deadline), deadline);
    if (response.status === 404 && (await errorOf(response)) === NO_ASSISTANT) {
      await response.body?.cancel();
      return null;
    }
    return this.#botOf(READ_ENDPOINT, response);
  }

  /** The bot in the harness's answer to `endpoint`, or why there is none. */
  async #botOf(endpoint: string, response: Response): Promise<MyBot> {
    if (response.status === 422) {
      await response.body?.cancel();
      throw new BotOwnerNotServedError("bots.owner_not_served");
    }
    if (response.status === 409 && (await errorOf(response)) === RECOVERY_NEEDED) {
      await response.body?.cancel();
      throw new BotRecoveryNeededError("bots.recovery_needed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#upstreamError(endpoint, String(response.status));
    }
    const bot = await readJson(response, myBotResponseSchema);
    if (!bot) {
      throw this.#upstreamError(endpoint, translate("log.net.unexpected_body"));
    }
    return bot;
  }

  /**
   * The direct room the client opened with the bot: the harness answers its owner
   * there. The client sends it as soon as it invites the bot, which joins a moment
   * later: the harness answers 409 until then, and ToM asks again within the
   * deadline.
   */
  async setHome(ownerId: string, roomId: string): Promise<void> {
    const deadline = Date.now() + this.#config.ready_timeout_ms;
    const path = `${PROVISIONING_PATH}/${encodeURIComponent(ownerId)}/home`;
    for (;;) {
      const response = await this.#put(
        HOME_ENDPOINT,
        path,
        {
          roomId,
        },
        deadline,
      );
      if (response.status === 409) {
        // "not a member" passes once the bot joins; "not a direct room" never does
        if ((await errorOf(response)) === NOT_A_DIRECT_ROOM) {
          await response.body?.cancel();
          throw new BotHomeRefusedError("bots.home_not_direct");
        }
        await this.#waitOrGiveUp(response, deadline, "log.bots.not_in_room");
        continue;
      }
      await response.body?.cancel();
      if (response.status === 404) {
        throw new BotNotProvisionedError("bots.not_provisioned");
      }
      if (!response.ok) {
        throw this.#upstreamError(HOME_ENDPOINT, String(response.status));
      }
      return;
    }
  }

  /**
   * The recovery of the owner's bot, after the harness lost its store: the
   * harness queues it (202) and `provision` answers the bot once it is done.
   */
  async recover(ownerId: string): Promise<void> {
    const deadline = Date.now() + this.#config.ready_timeout_ms;
    const path = `${PROVISIONING_PATH}/${encodeURIComponent(ownerId)}/recover`;
    const response = await this.#send("POST", RECOVER_ENDPOINT, path, {}, deadline);
    await response.body?.cancel();
    if (response.status === 404) {
      throw new BotNotProvisionedError("bots.not_provisioned");
    }
    if (response.status === 422) {
      throw new BotOwnerNotServedError("bots.owner_not_served");
    }
    if (!response.ok) {
      throw this.#upstreamError(RECOVER_ENDPOINT, String(response.status));
    }
  }

  /**
   * The first answer of the harness that is not 503: while it prepares the
   * identity of the bot, ToM asks again within the deadline.
   */
  async #onceReady(send: () => Promise<Response>, deadline: number): Promise<Response> {
    for (;;) {
      const response = await send();
      if (response.status !== 503) return response;
      await this.#waitOrGiveUp(response, deadline, "log.bots.not_ready");
    }
  }

  /**
   * Waits as long as the harness asks (Retry-After, in seconds), or a second when
   * it does not say. A wait the time left cannot afford ends the route at once:
   * the client tries later (503).
   */
  async #waitOrGiveUp(response: Response, deadline: number, logKey: string): Promise<void> {
    await response.body?.cancel();
    const header = response.headers.get("Retry-After");
    const asked = header === null ? Number.NaN : Number(header);
    const wait = Number.isFinite(asked) && asked >= 0 ? asked * 1000 : READY_POLL_MS;
    if (Date.now() + wait >= deadline) {
      throw this.#notReady(logKey);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  #notReady(logKey: string): BotNotReadyError {
    this.#log.warn(translate(logKey));
    return new BotNotReadyError("bots.not_ready");
  }

  /**
   * A call to the harness with ToM's token; a token it refuses is replaced once
   * (expired, revoked). `endpoint` names the call in the logs, without the owner.
   */
  #put(endpoint: string, path: string, body: Record<string, unknown>, deadline: number): Promise<Response> {
    return this.#send("PUT", endpoint, path, body, deadline);
  }

  async #send(
    method: "GET" | "PUT" | "POST",
    endpoint: string,
    path: string,
    body: Record<string, unknown> | null,
    deadline: number,
  ): Promise<Response> {
    const response = await this.#sendOnce(method, endpoint, path, body, deadline);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    this.#token = null;
    return this.#sendOnce(method, endpoint, path, body, deadline);
  }

  /** A JSON body when there is one: a read sends none. */
  async #sendOnce(
    method: "GET" | "PUT" | "POST",
    endpoint: string,
    path: string,
    body: Record<string, unknown> | null,
    deadline: number,
  ): Promise<Response> {
    const token = await this.#accessToken(deadline);
    return this.#within(deadline, endpoint, (signal) =>
      fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          ...(body === null
            ? {}
            : {
                "Content-Type": "application/json",
              }),
          Authorization: `Bearer ${token}`,
        },
        body: body === null ? null : JSON.stringify(body),
        signal,
      }),
    );
  }

  /**
   * A call to the harness or the OIDC provider, cut at `timeout_ms` or at the
   * deadline, whichever comes first. Cut by the deadline, the client tries later
   * (503); failing otherwise, it is a bad gateway (502).
   */
  async #within(
    deadline: number,
    endpoint: string,
    call: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw this.#notReady("log.bots.not_ready");
    }
    const deadlineFirst = remaining < this.#config.timeout_ms;
    try {
      return await call(AbortSignal.timeout(Math.min(remaining, this.#config.timeout_ms)));
    } catch (err) {
      if (deadlineFirst && isTimeout(err)) {
        throw this.#notReady("log.bots.not_ready");
      }
      throw this.#upstreamError(endpoint, reasonOf(err));
    }
  }

  /**
   * A token of ToM's own client, from the client credentials grant, kept until it
   * nearly expires. One request at a time: concurrent calls wait for the same one.
   */
  #accessToken(deadline: number): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now()) {
      return Promise.resolve(this.#token.value);
    }
    this.#tokenRequest ??= this.#requestToken(deadline).finally(() => {
      this.#tokenRequest = null;
    });
    return this.#tokenRequest;
  }

  async #requestToken(deadline: number): Promise<string> {
    const response = await this.#within(deadline, TOKEN_ENDPOINT, (signal) =>
      fetch(this.#harness.token_url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${formEncode(this.#harness.client_id)}:${formEncode(this.#harness.client_secret)}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: this.#harness.scope,
        }),
        signal,
      }),
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#upstreamError(TOKEN_ENDPOINT, String(response.status));
    }
    const token = await readJson(response, tokenResponseSchema);
    if (!token) {
      throw this.#upstreamError(TOKEN_ENDPOINT, translate("log.net.unexpected_body"));
    }
    this.#token = {
      value: token.access_token,
      expiresAt: Date.now() + (token.expires_in ?? 60) * 1000 - TOKEN_MARGIN_MS,
    };
    return token.access_token;
  }

  /** Logged with the endpoint and the status or the reason, never what the harness answered. */
  #upstreamError(endpoint: string, reason: string): BotsUpstreamError {
    this.#log.error(
      translate("log.bots.harness_failure", {
        endpoint,
        reason,
      }),
    );
    return new BotsUpstreamError("bots.harness_failure", {
      endpoint,
    });
  }
}
