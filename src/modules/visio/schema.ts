import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const REQUIRED_WHEN_ENABLED = [
  "base_url",
  "client_id",
  "client_secret",
] as const;
const LIVEKIT_REQUIRED_WHEN_ENABLED = [
  "url",
  "api_key",
  "api_secret",
] as const;

/** How the rooms ToM creates for the calls of Twake Chat are configured (D30 of Twake Chat). */
const roomConfigurationSchema = z.object({
  screen_recording_permission: z
    .enum([
      "admin_owner",
      "authenticated",
    ])
    .default("authenticated"),
  transcript_permission: z
    .enum([
      "admin_owner",
      "authenticated",
    ])
    .default("authenticated"),
  everyone_can_mute: z.boolean().default(false),
});

export const visioSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    base_url: z.url().optional(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    room_access_level: z
      .enum([
        "public",
        "trusted",
        "restricted",
      ])
      .optional(),
    /** The owner of the rooms of the calls of Twake Chat: a service account, no human. */
    service_account_email: z.email().optional(),
    room_configuration: roomConfigurationSchema.prefault({}),
    timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    for (const key of REQUIRED_WHEN_ENABLED) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [
            key,
          ],
          message: `visio.${key} is required when visio.enabled is true`,
        });
      }
    }
  });

export const visioTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

export const visioRoomResponseSchema = z.object({
  url: z.url(),
});

export const threepidsSchema = z.object({
  threepids: z.array(
    z.object({
      medium: z.string(),
      address: z.string(),
    }),
  ),
});

/** The LiveKit server the calls of Twake Chat use, and the key ToM signs tokens with (D30, D-d). */
export const livekitSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z.string().optional(),
    api_key: z.string().optional(),
    api_secret: z.string().optional(),
    token_ttl_seconds: z.number().int().positive().default(DEFAULT_TOKEN_TTL_SECONDS),
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) {
      return;
    }

    for (const key of LIVEKIT_REQUIRED_WHEN_ENABLED) {
      if (!value[key]) {
        ctx.addIssue({
          code: "custom",
          path: [
            key,
          ],
          message: `livekit.${key} is required when livekit.enabled is true`,
        });
      }
    }
  });

/** The request of a MatrixRTC client to its token service (MSC4195, `POST /sfu/get`). */
export const sfuGetRequestSchema = z.object({
  room: z.string().min(1),
  openid_token: z.object({
    access_token: z.string().min(1),
    token_type: z.string(),
    matrix_server_name: z.string().min(1),
    expires_in: z.number().optional(),
  }),
  device_id: z.string().min(1),
});

/** `GET /_matrix/federation/v1/openid/userinfo`: the user the OpenID token stands for. */
export const openIdUserInfoSchema = z.object({
  sub: z.string().regex(/^@[^:]+:.+$/),
});

/** `GET /_synapse/admin/v1/rooms/{roomId}/members` */
export const roomMembersSchema = z.object({
  members: z.array(z.string()),
});

/** `GET /_synapse/admin/v1/rooms/{roomId}/state`: only the power levels are read. */
export const roomStateSchema = z.object({
  state: z.array(
    z.object({
      type: z.string(),
      content: z.record(z.string(), z.unknown()),
    }),
  ),
});

/** `GET /_synapse/admin/v2/users/{userId}`: the name, the emails and the OIDC identity of a user. */
export const adminUserSchema = z.object({
  displayname: z.string().nullable().optional(),
  threepids: z
    .array(
      z.object({
        medium: z.string(),
        address: z.string(),
      }),
    )
    .default([]),
  external_ids: z
    .array(
      z.object({
        auth_provider: z.string(),
        external_id: z.string(),
      }),
    )
    .default([]),
});

export const loginResponseSchema = z.object({
  access_token: z.string().min(1),
});

/** `POST /external-api/v1.0/rooms/`: the room Meet created. */
export const meetRoomSchema = z.object({
  id: z.string().min(1),
  slug: z.string().optional(),
});

/** `POST /external-api/v1.0/rooms/{id}/livekit-token/`: the token Meet minted. */
export const meetLivekitTokenSchema = z.object({
  room: z.string().min(1),
  token: z.string().min(1),
});
