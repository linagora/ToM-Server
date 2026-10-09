import { z } from "zod";

/** The public web pages of the rooms anyone may read, for people with no account (D90 of Twake Chat). */
export const publicPagesSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** The origin the pages are reached at, with no trailing slash: canonical, Open Graph and sitemap URLs. */
    public_url: z.string().default(""),
    /** Twake Chat, for the « Follow in Twake Chat » link; no link when empty. */
    chat_url: z.string().default(""),
    lang: z.string().default("en"),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && !value.public_url) {
      ctx.addIssue({
        code: "custom",
        path: [
          "public_url",
        ],
        message: "public_pages.public_url is required when public_pages.enabled is true",
      });
    }
  });

const eventShape = {
  type: z.string(),
  content: z.record(z.string(), z.unknown()).default({}),
};

/** `GET /_synapse/admin/v1/rooms/{roomId}/state` */
export const stateSchema = z.object({
  state: z.array(
    z.object({
      ...eventShape,
      state_key: z.string().default(""),
    }),
  ),
});

/** `GET /_synapse/admin/v1/rooms/{roomId}/messages` */
export const messagesSchema = z.object({
  chunk: z
    .array(
      z.object({
        ...eventShape,
        event_id: z.string(),
        sender: z.string(),
        origin_server_ts: z.number(),
      }),
    )
    .default([]),
});

/** `GET /_matrix/client/v3/directory/room/{alias}` */
export const aliasSchema = z.object({
  room_id: z.string(),
});

/** `GET /_synapse/admin/v1/rooms`: what the sitemap needs of each room. */
export const roomListSchema = z.object({
  rooms: z
    .array(
      z.object({
        room_id: z.string(),
        canonical_alias: z.string().nullish(),
        history_visibility: z.string().nullish(),
        join_rules: z.string().nullish(),
        encryption: z.string().nullish(),
        room_type: z.string().nullish(),
      }),
    )
    .default([]),
  /** The offset of the next page; absent on the last one. */
  next_batch: z.number().nullish(),
});
