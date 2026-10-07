import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_READY_TIMEOUT_MS = 12000;
const DEFAULT_PUBLISH_INTERVAL_MS = 60000;

const commandSchema = z.object({
  name: z.string().min(1),
  syntax: z.string().min(1),
  description: z.string().default(""),
});

/**
 * The agent harness of the platform (linagora/twake-harness), which owns the
 * assistants as its application service: ToM asks it for the bot of a user,
 * with a token of its own OIDC client (client credentials grant).
 */
const harnessSettingsSchema = z.object({
  /** The base of the harness API (its `/v1` routes), as ToM reaches it. */
  url: z.url(),
  /** The token endpoint of the OIDC provider. */
  token_url: z.url(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

/**
 * The assistants of the users (Twake Chat, DECISION.md D27): one Hermes profile
 * per user, or the agent harness of the platform. One backend or the other.
 */
export const botsSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    backend: z
      .enum([
        "hermes",
        "harness",
      ])
      .default("hermes"),
    harness: harnessSettingsSchema.optional(),
    /** Where the shared Hermes agent reads its profiles (`$HERMES_HOME/profiles`), as ToM sees it. */
    hermes_profiles_dir: z.string().optional(),
    /** The home of the agent as the agent sees it (`/opt/data` in its image): paths written in a profile. */
    hermes_home: z.string().default("/opt/data"),
    /** The homeserver as Hermes reaches it; the public one when unset. */
    hermes_homeserver_url: z.url().optional(),
    model: z
      .object({
        provider: z.string().default("openrouter"),
        name: z.string().default("anthropic/claude-haiku-4.5"),
        api_key: z.string().optional(),
      })
      .prefault({}),
    bot_localpart_prefix: z.string().default("bot_"),
    device_id_prefix: z.string().default("HERMES"),
    /** What the bot announces in its rooms (MSC4332). */
    commands: z.array(commandSchema).default([
      {
        name: "help",
        syntax: "help",
        description: "What the assistant can do",
      },
    ]),
    timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
    /** How long `bots/me` waits for the keys of a bot Hermes has just started. */
    ready_timeout_ms: z.number().int().nonnegative().default(DEFAULT_READY_TIMEOUT_MS),
    publish_interval_ms: z.number().int().positive().default(DEFAULT_PUBLISH_INTERVAL_MS),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    if (value.backend === "harness") {
      if (!value.harness) {
        ctx.addIssue({
          code: "custom",
          path: [
            "harness",
          ],
          message: "bots.harness is required when bots.backend is harness",
        });
      }
      // Hermes and the harness would both claim the same accounts
      if (value.hermes_profiles_dir) {
        ctx.addIssue({
          code: "custom",
          path: [
            "hermes_profiles_dir",
          ],
          message: "a ToM served by the harness runs no Hermes profile: unset bots.hermes_profiles_dir",
        });
      }
      return;
    }

    if (!value.hermes_profiles_dir) {
      ctx.addIssue({
        code: "custom",
        path: [
          "hermes_profiles_dir",
        ],
        message: "bots.hermes_profiles_dir is required when bots.enabled is true",
      });
    }
    if (value.harness) {
      ctx.addIssue({
        code: "custom",
        path: [
          "harness",
        ],
        message:
          "bots.harness is only read when bots.backend is harness: Hermes and the harness never serve one ToM together",
      });
    }
  });

export const myBotResponseSchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  masterKey: z.string().min(1),
});

export const loginResponseSchema = z.object({
  access_token: z.string().min(1),
  device_id: z.string().optional(),
});

export const keysQueryResponseSchema = z.object({
  master_keys: z
    .record(
      z.string(),
      z.object({
        keys: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
  device_keys: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export const joinedRoomsSchema = z.object({
  joined_rooms: z.array(z.string()),
});

/**
 * The IANA timezone of the owner's browser, sent by the client (`bots/me`). Written in a
 * YAML file: the name only, never a newline. Anything else is ignored.
 */
export const myBotRequestSchema = z.object({
  timezone: z
    .string()
    .regex(/^[A-Za-z0-9_+\-/]{1,64}$/)
    .optional()
    .catch(undefined),
});

/** The direct room of the owner with the bot, sent by the client (`bots/me/home`). */
export const homeRequestSchema = z.object({
  room_id: z.string().regex(/^![^:]+:.+$/),
});
