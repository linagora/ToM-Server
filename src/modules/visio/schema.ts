import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 10000;
const REQUIRED_WHEN_ENABLED = [
  "base_url",
  "client_id",
  "client_secret",
] as const;

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
