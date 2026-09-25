import { z } from "zod";

const DEFAULT_TOKEN_CACHE_SIZE = 1000;
const DEFAULT_TOKEN_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export const authSettingsSchema = z.object({
  token_cache_size: z.number().int().positive().default(DEFAULT_TOKEN_CACHE_SIZE),
  token_cache_ttl_ms: z.number().int().positive().default(DEFAULT_TOKEN_CACHE_TTL_MS),
  timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
});

export const whoamiSchema = z.object({
  user_id: z.string().min(1),
});

export const threepidsSchema = z.object({
  threepids: z.array(
    z.object({
      medium: z.string(),
      address: z.string(),
    }),
  ),
});
