import { z } from "zod";

const DEFAULT_KLIPY_BASE_URL = "https://api.klipy.com";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_MEDIA_BYTES = 15 * 1024 * 1024;
const DEFAULT_TRENDING_CACHE_TTL_MS = 300000;

/** GIFs for Twake Chat through ToM: Klipy never sees the IP of the users. */
export const gifsSettingsSchema = z.object({
  /** The default of the switch; the admin API overrides it at run time. Without a key, always off. */
  enabled: z.boolean().default(false),
  klipy_api_key: z.string().default(""),
  klipy_base_url: z.url().default(DEFAULT_KLIPY_BASE_URL),
  /** Keys the hash of the Matrix id sent to Klipy as `customer_id`. The API key when unset. */
  customer_id_secret: z.string().default(""),
  content_filter: z
    .enum([
      "off",
      "low",
      "medium",
      "high",
    ])
    .default("medium"),
  timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  max_media_bytes: z.number().int().positive().default(DEFAULT_MAX_MEDIA_BYTES),
  trending_cache_ttl_ms: z.number().int().nonnegative().default(DEFAULT_TRENDING_CACHE_TTL_MS),
});

/** The body of `PUT /_twake/v1/admin/features/gifs`. */
export const switchRequestSchema = z.object({
  enabled: z.boolean(),
});

export const mediaFileSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
});

/** One item of Klipy: `file[size][format]` is `{url, width, height, size}`. */
export const klipyItemSchema = z.object({
  slug: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().default(""),
  file: z.record(z.string(), z.record(z.string(), z.unknown())),
});

export const klipyResponseSchema = z.object({
  data: z.object({
    data: z.array(z.unknown()),
    has_next: z.boolean().default(false),
  }),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  locale: z.string().optional(),
});

export const trendingQuerySchema = searchQuerySchema.omit({
  q: true,
});

export const mediaParamsSchema = z.object({
  id: klipyItemSchema.shape.slug,
  variant: z.enum([
    "preview",
    "full",
  ]),
  exp: z.coerce.number().int(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
});
