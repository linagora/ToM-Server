import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { BotNotProvisionedError, BotNotReadyError, BotsDisabledError, BotsUpstreamError } from "./errors";
import { keysQueryResponseSchema, loginResponseSchema } from "./schema";
import type { BotsSettings, MyBot, SynapseAccess } from "./types";

const LOGIN_PATH = "/_matrix/client/v3/login";
const KEYS_QUERY_PATH = "/_matrix/client/v3/keys/query";
const READY_POLL_MS = 1000;

/** The Matrix ids of the bot of an owner, and the localpart that names its Hermes profile. */
export interface BotIds {
  localpart: string;
  userId: string;
  deviceId: string;
}

export const botIds = (
  ownerId: string,
  config: Pick<BotsSettings, "bot_localpart_prefix" | "device_id_prefix">,
  serverName: string,
): BotIds => {
  const ownerLocalpart = ownerId.slice(1, ownerId.indexOf(":"));
  const localpart = `${config.bot_localpart_prefix}${ownerLocalpart}`;
  return {
    localpart,
    userId: `@${localpart}:${serverName}`,
    deviceId: `${config.device_id_prefix}${ownerLocalpart.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
  };
};

/**
 * Provisions the assistant of a user (DECISION.md D27 of Twake Chat): the Matrix
 * account of the bot, a device for the shared Hermes agent, its profile on disk,
 * and the master key the client checks before trusting the bot. Hermes makes the
 * identity of the bot itself at its first start (cross-signing bootstrap): until
 * its keys are published, `bots/me` answers 503 and the client tries later.
 */
export class BotsService {
  #config: BotsSettings;
  #synapse: SynapseAccess;
  #http: HttpClient;
  #log: Logger;
  #adminToken: string | null = null;

  constructor(config: BotsSettings, synapse: SynapseAccess, logger: Logger) {
    this.#config = config;
    this.#synapse = synapse;
    this.#http = new HttpClient({
      baseUrl: synapse.serverUrl,
      timeoutMs: config.timeout_ms,
    });
    this.#log = logger;
  }

  async provision(ownerId: string, ownerToken: string, timezone?: string): Promise<MyBot> {
    const bot = botIds(ownerId, this.#config, this.#synapse.serverName);
    const profileDir = this.#profileDir(bot);

    if (!existsSync(this.#envFile(bot))) {
      await this.#createAccount(bot.userId, ownerId);
      const token = await this.#login(bot.localpart, bot.deviceId);
      this.#writeProfile(profileDir, bot.userId, bot.deviceId, token, ownerId);
      this.#log.info(translate("log.bots.provisioned"), {
        bot: bot.userId,
      });
    }
    if (timezone) this.#saveTimezone(profileDir, timezone);

    return this.#withKeys(bot, ownerToken);
  }

  /** The bot of the owner once its profile is written, never made: none before. */
  async find(ownerId: string, ownerToken: string): Promise<MyBot | null> {
    const bot = botIds(ownerId, this.#config, this.#synapse.serverName);
    if (!existsSync(this.#envFile(bot))) {
      return null;
    }
    return await this.#withKeys(bot, ownerToken);
  }

  /**
   * The room where Hermes delivers what the bot does on its own (cron jobs):
   * the direct room of the owner with the bot, set by the client as soon as
   * it opens it, as `/sethome` would (`MATRIX_HOME_ROOM` of the profile).
   */
  /** Hermes keeps the keys of its bots on its volume: there is nothing to recover (404). */
  recover(_ownerId: string): void {
    throw new BotsDisabledError("bots.recovery_unsupported");
  }

  setHome(ownerId: string, roomId: string): void {
    const bot = botIds(ownerId, this.#config, this.#synapse.serverName);
    const envFile = this.#envFile(bot);
    if (!existsSync(envFile)) {
      throw new BotNotProvisionedError("bots.not_provisioned", {
        bot: bot.userId,
      });
    }
    const lines = readFileSync(envFile, "utf8")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("MATRIX_HOME_ROOM="));
    writeFileSync(
      envFile,
      [
        ...lines,
        `MATRIX_HOME_ROOM=${roomId}`,
        "",
      ].join("\n"),
    );
    // The profile holds the token of the bot: its owner only, as when written
    chmodSync(envFile, 0o600);
  }

  /**
   * The timezone of the owner, where Hermes reads it under the multiplexed gateway
   * (`timezone` of `config.yaml`; `HERMES_TIMEZONE` speaks for the default profile only):
   * the clock of the agent and its cron jobs. Rewritten only when it changes.
   */
  // ponytail: Hermes caches the timezone of a profile once read, so a change to an
  // existing profile applies at its next restart; a new profile gets it before its first start
  #saveTimezone(profileDir: string, timezone: string): void {
    const configFile = join(profileDir, "config.yaml");
    const lines = readFileSync(configFile, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    const line = `timezone: ${timezone}`;
    if (lines.includes(line)) return;
    writeFileSync(
      configFile,
      [
        ...lines.filter((l) => !l.startsWith("timezone:")),
        line,
        "",
      ].join("\n"),
    );
    chmodSync(configFile, 0o600);
  }

  /** The admin API of Synapse: the account, kept out of the directory and the stats. */
  async #createAccount(botUserId: string, ownerId: string): Promise<void> {
    const path = `/_synapse/admin/v2/users/${encodeURIComponent(botUserId)}`;
    const admin = await this.#admin();
    const response = await this.#request(() =>
      this.#http.put(
        path,
        {
          password: this.#password(botUserId),
          displayname: `${ownerId.slice(1, ownerId.indexOf(":"))} — assistant`,
          admin: false,
          user_type: "bot",
        },
        admin,
      ),
    );
    if (!response.ok) {
      throw this.#upstreamError(path, await this.#status(response));
    }
  }

  async #login(localpart: string, deviceId: string): Promise<string> {
    const response = await this.#request(() =>
      this.#http.post(LOGIN_PATH, {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: localpart,
        },
        password: this.#password(`@${localpart}:${this.#synapse.serverName}`),
        device_id: deviceId,
        initial_device_display_name: "Twake assistant",
      }),
    );
    const login = await this.#parse(LOGIN_PATH, response, loginResponseSchema);
    return login.access_token;
  }

  /** The Hermes profile of the bot, among the profiles of the agent. */
  #profileDir(bot: BotIds): string {
    return join(this.#config.hermes_profiles_dir ?? "", bot.localpart);
  }

  /** The `.env` of the profile of the bot: the bot exists once it is written. */
  #envFile(bot: BotIds): string {
    return join(this.#profileDir(bot), ".env");
  }

  /**
   * The profile of the shared Hermes agent, as its `hermes profile create` lays it
   * out: `.env` (credentials), `config.yaml` (model), `SOUL.md`. Hermes talks to
   * its owner only, listens to `!command`, makes its own cross-signing identity
   * and writes the recovery key once next to the profile.
   */
  #writeProfile(dir: string, botUserId: string, deviceId: string, token: string, ownerId: string): void {
    mkdirSync(dir, {
      recursive: true,
      mode: 0o700,
    });
    const { model } = this.#config;
    writeFileSync(
      join(dir, ".env"),
      [
        `MATRIX_HOMESERVER=${this.#config.hermes_homeserver_url ?? this.#synapse.serverUrl}`,
        `MATRIX_ACCESS_TOKEN=${token}`,
        `MATRIX_USER_ID=${botUserId}`,
        `MATRIX_DEVICE_ID=${deviceId}`,
        "MATRIX_E2EE_MODE=optional",
        `MATRIX_RECOVERY_KEY_OUTPUT_FILE=${this.#config.hermes_home}/profiles/${botUserId.slice(1, botUserId.indexOf(":"))}/recovery-key`,
        `MATRIX_ALLOWED_USERS=${ownerId}`,
        // Until the client gives the direct room (setHome): never empty, or
        // Hermes asks the owner to type /sethome in the chat
        `MATRIX_HOME_ROOM=${ownerId}`,
        "MATRIX_REQUIRE_MENTION=false",
        "MATRIX_AUTO_THREAD=false",
        "MATRIX_REACTIONS=false",
        ...(model.api_key && !model.base_url
          ? [
              `${model.provider.toUpperCase()}_API_KEY=${model.api_key}`,
            ]
          : []),
        "",
      ].join("\n"),
      {
        mode: 0o600,
      },
    );
    writeFileSync(
      join(dir, "config.yaml"),
      [
        "model:",
        `  provider: ${model.provider}`,
        ...(model.base_url
          ? [
              `  base_url: ${model.base_url}`,
              ...(model.api_key
                ? [
                    `  api_key: ${model.api_key}`,
                  ]
                : []),
            ]
          : []),
        `  default: ${model.name}`,
        "  api_mode: chat_completions",
        "agent:",
        "  max_turns: 8",
        "gateway:",
        "  progress: false",
        "",
      ].join("\n"),
      {
        mode: 0o600,
      },
    );
    writeFileSync(
      join(dir, "SOUL.md"),
      `You are the personal assistant of ${ownerId} in Twake Chat. Answer briefly, in the language of the message.\n`,
    );
  }

  /** The bot with the master key it published, which the client checks before trusting its device. */
  async #withKeys(
    bot: {
      userId: string;
      deviceId: string;
    },
    ownerToken: string,
  ): Promise<MyBot> {
    const masterKey = await this.#waitForKeys(bot.userId, bot.deviceId, ownerToken);
    return {
      userId: bot.userId,
      deviceId: bot.deviceId,
      masterKey,
    };
  }

  /** The keys the bot publishes, once Hermes has started with the profile. */
  async #waitForKeys(botUserId: string, deviceId: string, ownerToken: string): Promise<string> {
    const deadline = Date.now() + this.#config.ready_timeout_ms;
    for (;;) {
      const response = await this.#request(() =>
        this.#http.post(
          KEYS_QUERY_PATH,
          {
            device_keys: {
              [botUserId]: [],
            },
          },
          ownerToken,
        ),
      );
      const keys = await this.#parse(KEYS_QUERY_PATH, response, keysQueryResponseSchema);
      const masterKey = Object.values(keys.master_keys?.[botUserId]?.keys ?? {})[0];
      const hasDevice = keys.device_keys?.[botUserId]?.[deviceId] !== undefined;
      if (masterKey && hasDevice) {
        return masterKey;
      }
      if (Date.now() >= deadline) {
        this.#log.warn(translate("log.bots.not_ready"), {
          bot: botUserId,
        });
        throw new BotNotReadyError("bots.not_ready", {
          bot: botUserId,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }

  async #admin(): Promise<string> {
    if (this.#adminToken) {
      return this.#adminToken;
    }
    if (this.#synapse.admin.accessToken) {
      this.#adminToken = this.#synapse.admin.accessToken;
      return this.#adminToken;
    }
    const response = await this.#request(() =>
      this.#http.post(LOGIN_PATH, {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: this.#synapse.admin.login,
        },
        password: this.#synapse.admin.password,
        initial_device_display_name: "ToM bots",
      }),
    );
    const login = await this.#parse(LOGIN_PATH, response, loginResponseSchema);
    this.#adminToken = login.access_token;
    return this.#adminToken;
  }

  /**
   * ponytail: the password of a bot is derived from a secret kept in memory for
   * the life of the process; it is only needed between the creation of the
   * account and the login a moment later, and a restart makes a new one. A bot
   * created by an earlier process keeps its profile, which holds its token.
   */
  #password(botUserId: string): string {
    this.#secret ??= randomBytes(32).toString("base64url");
    return `${this.#secret}:${botUserId}`;
  }
  #secret: string | null = null;

  async #request(send: () => Promise<Response>): Promise<Response> {
    try {
      return await send();
    } catch (err) {
      throw this.#upstreamError("homeserver", err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
  }

  async #parse<Schema extends z.ZodType>(path: string, response: Response, schema: Schema): Promise<z.infer<Schema>> {
    if (!response.ok) {
      throw this.#upstreamError(path, await this.#status(response));
    }
    const body = await readJson(response, schema);
    if (body === undefined) {
      throw this.#upstreamError(path, translate("log.net.unexpected_body"));
    }
    return body;
  }

  async #status(response: Response): Promise<string> {
    return translate("log.net.status", {
      status: String(response.status),
      body: (await response.text()).slice(0, 200),
    });
  }

  #upstreamError(endpoint: string, reason: string): BotsUpstreamError {
    this.#log.error(
      translate("log.bots.upstream_failure", {
        endpoint,
        reason,
      }),
    );
    return new BotsUpstreamError("bots.upstream_failure", {
      endpoint,
    });
  }
}
