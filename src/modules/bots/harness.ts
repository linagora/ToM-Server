import type { Logger } from "winston";
import { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { BotNotProvisionedError, BotNotReadyError, BotOwnerNotServedError, BotsUpstreamError } from "./errors";
import { myBotResponseSchema } from "./schema";
import type { BotsSettings, HarnessSettings, MyBot } from "./types";

const PROVISIONING_PATH = "/v1/provisioning/assistants";
/** Between two calls while the harness prepares a bot, unless it says otherwise. */
const READY_POLL_MS = 1000;
/** A token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 30000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

/**
 * The assistants served by the agent harness of the platform, which owns them
 * as its application service: ToM asks it for the bot of a user, and answers
 * the client exactly as the Hermes backend does. ToM calls it with a token of
 * its own OIDC client (client credentials), never with the user's.
 */
export class HarnessBotsService {
  #config: BotsSettings;
  #harness: HarnessSettings;
  #http: HttpClient;
  #log: Logger;
  #token: {
    value: string;
    expiresAt: number;
  } | null = null;

  constructor(config: BotsSettings, harness: HarnessSettings, logger: Logger) {
    this.#config = config;
    this.#harness = harness;
    this.#http = new HttpClient({
      baseUrl: harness.url,
      timeoutMs: config.timeout_ms,
    });
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
    for (;;) {
      const response = await this.#put(path, body);
      if (response.status !== 503) {
        return this.#botOf(response, ownerId);
      }
      await this.#waitOrGiveUp(response, deadline, ownerId, "log.bots.not_ready");
    }
  }

  /** The bot in the harness's answer, or why there is none. */
  async #botOf(response: Response, ownerId: string): Promise<MyBot> {
    if (response.status === 422) {
      await response.body?.cancel();
      throw new BotOwnerNotServedError("bots.owner_not_served", {
        owner: ownerId,
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#upstreamError(PROVISIONING_PATH, String(response.status));
    }
    const bot = await readJson(response, myBotResponseSchema);
    if (!bot) {
      throw this.#upstreamError(PROVISIONING_PATH, translate("log.net.unexpected_body"));
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
      const response = await this.#put(path, {
        roomId,
      });
      if (response.status === 409) {
        await this.#waitOrGiveUp(response, deadline, ownerId, "log.bots.not_in_room");
        continue;
      }
      await response.body?.cancel();
      if (response.status === 404) {
        throw new BotNotProvisionedError("bots.not_provisioned", {
          owner: ownerId,
        });
      }
      if (!response.ok) {
        throw this.#upstreamError(`${PROVISIONING_PATH}/home`, String(response.status));
      }
      return;
    }
  }

  /**
   * Waits as long as the harness asks (Retry-After, in seconds), or a second when
   * it does not say, within the deadline; past it, the client tries later (503).
   */
  async #waitOrGiveUp(response: Response, deadline: number, ownerId: string, logKey: string): Promise<void> {
    await response.body?.cancel();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      this.#log.warn(translate(logKey), {
        owner: ownerId,
      });
      throw new BotNotReadyError("bots.not_ready", {
        owner: ownerId,
      });
    }
    const header = response.headers.get("Retry-After");
    const asked = header === null ? Number.NaN : Number(header);
    const wait = Number.isFinite(asked) && asked >= 0 ? asked * 1000 : READY_POLL_MS;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, remaining)));
  }

  /** A PUT to the harness with ToM's token; a token it refuses is replaced once (expired, revoked). */
  async #put(path: string, body: Record<string, unknown>): Promise<Response> {
    const response = await this.#putOnce(path, body);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    this.#token = null;
    return this.#putOnce(path, body);
  }

  async #putOnce(path: string, body: Record<string, unknown>): Promise<Response> {
    const token = await this.#accessToken();
    try {
      return await this.#http.put(path, body, token);
    } catch (err) {
      throw this.#upstreamError(path, err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
  }

  /** A token of ToM's own client, from the client credentials grant, kept until it nearly expires. */
  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now()) {
      return this.#token.value;
    }
    let response: Response;
    try {
      response = await fetch(this.#harness.token_url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.#harness.client_id}:${this.#harness.client_secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: this.#harness.scope,
        }),
        signal: AbortSignal.timeout(this.#config.timeout_ms),
      });
    } catch (err) {
      throw this.#upstreamError("token", err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw this.#upstreamError("token", String(response.status));
    }
    const token = await readJson(response, tokenResponseSchema);
    if (!token) {
      throw this.#upstreamError("token", translate("log.net.unexpected_body"));
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
