import { createHmac, timingSafeEqual } from "node:crypto";

import { Lru } from "toad-cache";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { GifsDisabledError, GifsSignatureError, GifsUpstreamError } from "./errors";
import { klipyItemSchema, klipyResponseSchema, mediaFileSchema } from "./schema";
import type { Gif, GifPage, GifsFlag, GifsSettings, Variant } from "./types";

export const MEDIA_ROUTE = "/_twake/v1/gifs/media";

const PAGE_SIZE = 24;
const SIGNATURE_TTL_S = 3600;
const MEDIA_CACHE_SIZE = 5000;
const MEDIA_CACHE_TTL_MS = 3600000;
const TRENDING_CACHE_SIZE = 50;
const KLIPY_HOST = "klipy.com";
const MEDIA_TYPES = new Set([
  "image/gif",
  "image/webp",
  "image/png",
  "image/jpeg",
  "video/mp4",
  "video/webm",
]);
// ponytail: the first size and format found wins; tune here if the sizes of Klipy change
const PICKS: Record<
  Variant,
  {
    sizes: string[];
    formats: string[];
  }
> = {
  preview: {
    sizes: [
      "sm",
      "xs",
      "md",
      "hd",
    ],
    formats: [
      "webp",
      "gif",
    ],
  },
  full: {
    sizes: [
      "md",
      "hd",
      "sm",
    ],
    formats: [
      "gif",
      "webp",
      "mp4",
    ],
  },
};

interface Found {
  url: string;
  width: number;
  height: number;
}

/** A GIF as Klipy gave it, before the URLs of the proxy are signed. */
interface Trimmed {
  id: string;
  title: string;
  width: number;
  height: number;
}

interface TrimmedPage {
  items: Trimmed[];
  hasNext: boolean;
}

export interface MediaStream {
  contentType: string;
  body: ReadableStream<Uint8Array>;
}

const pick = (file: Record<string, Record<string, unknown>>, variant: Variant): Found | undefined => {
  for (const size of PICKS[variant].sizes) {
    for (const format of PICKS[variant].formats) {
      const found = mediaFileSchema.safeParse(file[size]?.[format]);
      if (found.success) {
        return found.data;
      }
    }
  }
  return undefined;
};

/** `fr-FR` gives `fr`, `en_GB` gives `gb`: Klipy wants a country code. Anything else is dropped. */
const normalizeLocale = (locale: string | undefined): string | undefined => {
  const match = /^([A-Za-z]{2})(?:[-_]([A-Za-z]{2}))?$/.exec(locale ?? "");
  return match ? (match[2] ?? match[1])?.toLowerCase() : undefined;
};

const isKlipyUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === KLIPY_HOST || url.hostname.endsWith(`.${KLIPY_HOST}`));
  } catch {
    return false;
  }
};

export class GifsService {
  #config: GifsSettings;
  #flag: GifsFlag;
  #baseUrl: string;
  #log: Logger;
  #fetch: typeof fetch;
  #urls: Lru<Partial<Record<Variant, string>>>;
  #trending: Lru<TrimmedPage>;

  constructor(
    config: GifsSettings,
    flag: GifsFlag,
    publicBaseUrl: string,
    logger: Logger,
    fetchFn: typeof fetch = fetch,
  ) {
    this.#config = config;
    this.#flag = flag;
    this.#baseUrl = publicBaseUrl.replace(/\/+$/, "");
    this.#log = logger;
    this.#fetch = fetchFn;
    this.#urls = new Lru(MEDIA_CACHE_SIZE, MEDIA_CACHE_TTL_MS);
    this.#trending = new Lru(TRENDING_CACHE_SIZE, config.trending_cache_ttl_ms);
  }

  /** The switch: the admin's choice, else the config. Without an API key, it does not matter. */
  async switchValue(): Promise<boolean> {
    return (await this.#flag.get()) ?? this.#config.enabled;
  }

  async isAvailable(): Promise<boolean> {
    return this.#config.klipy_api_key !== "" && (await this.switchValue());
  }

  async setSwitch(enabled: boolean): Promise<void> {
    await this.#flag.set(enabled);
  }

  async search(userId: string, q: string, page: number, locale?: string): Promise<GifPage> {
    await this.#assertAvailable();
    return this.#page(await this.#list("search", userId, page, locale, q), page);
  }

  async trending(userId: string, page: number, locale?: string): Promise<GifPage> {
    await this.#assertAvailable();
    const key = `${normalizeLocale(locale) ?? ""}|${page}`;
    let cached = this.#trending.get(key);
    if (!cached) {
      cached = await this.#list("trending", userId, page, locale);
      this.#trending.set(key, cached);
    }
    return this.#page(cached, page);
  }

  /** Streams a GIF of Klipy; the URL was signed by `search` or `trending`. */
  async media(id: string, variant: Variant, exp: number, sig: string): Promise<MediaStream> {
    await this.#assertAvailable();
    this.#verify(id, variant, exp, sig);

    const url = this.#urls.get(id)?.[variant] ?? (await this.#refresh(id))?.[variant];
    if (!url || !isKlipyUrl(url)) {
      throw new GifsUpstreamError("gifs.media_not_found", {
        id,
      });
    }

    const response = await this.#get(url);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const length = Number(response.headers.get("content-length") ?? 0);
    if (!MEDIA_TYPES.has(contentType) || length > this.#config.max_media_bytes || !response.body) {
      await response.body?.cancel();
      throw new GifsUpstreamError("gifs.media_refused", {
        id,
      });
    }

    // The declared length can lie: count what comes
    let total = 0;
    const max = this.#config.max_media_bytes;
    return {
      contentType,
      body: response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): void => {
            total += chunk.byteLength;
            if (total > max) {
              controller.error(new Error("media too large"));
            } else {
              controller.enqueue(chunk);
            }
          },
        }),
      ),
    };
  }

  async #assertAvailable(): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new GifsDisabledError("gifs.disabled");
    }
  }

  /** Nothing of the user goes to Klipy but this hash: no IP, no header, no Matrix id. */
  #customerId(userId: string): string {
    return createHmac("sha256", this.#secret("customer")).update(userId).digest("hex");
  }

  #secret(purpose: string): string {
    return createHmac("sha256", this.#config.customer_id_secret || this.#config.klipy_api_key)
      .update(purpose)
      .digest("hex");
  }

  #sign(id: string, variant: Variant, exp: number): string {
    return createHmac("sha256", this.#secret("media")).update(`${id}|${variant}|${exp}`).digest("hex");
  }

  #verify(id: string, variant: Variant, exp: number, sig: string): void {
    const expected = Buffer.from(this.#sign(id, variant, exp));
    const received = Buffer.from(sig);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new GifsSignatureError("gifs.bad_signature");
    }
    if (exp < Date.now() / 1000) {
      throw new GifsSignatureError("gifs.expired_signature");
    }
  }

  #mediaUrl(id: string, variant: Variant): string {
    const exp = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_S;
    return `${this.#baseUrl}${MEDIA_ROUTE}/${id}/${variant}?exp=${exp}&sig=${this.#sign(id, variant, exp)}`;
  }

  #page(page: TrimmedPage, number: number): GifPage {
    return {
      results: page.items.map(
        (item): Gif => ({
          ...item,
          preview_url: this.#mediaUrl(item.id, "preview"),
          url: this.#mediaUrl(item.id, "full"),
        }),
      ),
      next_page: page.hasNext ? number + 1 : null,
    };
  }

  #list(
    kind: "search" | "trending",
    userId: string,
    page: number,
    locale: string | undefined,
    q?: string,
  ): Promise<TrimmedPage> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(PAGE_SIZE),
      customer_id: this.#customerId(userId),
      content_filter: this.#config.content_filter,
    });
    const country = normalizeLocale(locale);
    if (country) {
      params.set("locale", country);
    }
    if (q !== undefined) {
      params.set("q", q);
    }
    return this.#fetchItems(`${kind}?${params}`);
  }

  async #fetchItems(path: string): Promise<TrimmedPage> {
    const base = this.#config.klipy_base_url.replace(/\/+$/, "");
    const response = await this.#get(`${base}/api/v1/${encodeURIComponent(this.#config.klipy_api_key)}/gifs/${path}`);
    const parsed = klipyResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new GifsUpstreamError("gifs.upstream_failure");
    }

    const items: Trimmed[] = [];
    for (const raw of parsed.data.data.data) {
      const item = klipyItemSchema.safeParse(raw);
      const full = item.success ? pick(item.data.file, "full") : undefined;
      if (!item.success || !full || !isKlipyUrl(full.url)) {
        continue;
      }
      const preview = pick(item.data.file, "preview");
      this.#urls.set(item.data.slug, {
        full: full.url,
        preview: preview && isKlipyUrl(preview.url) ? preview.url : full.url,
      });
      items.push({
        id: item.data.slug,
        title: item.data.title,
        width: full.width,
        height: full.height,
      });
    }

    return {
      items,
      hasNext: parsed.data.data.has_next,
    };
  }

  /** The URLs of a GIF the cache forgot (restart, expiry, another instance): ask Klipy again. */
  async #refresh(id: string): Promise<Partial<Record<Variant, string>> | undefined> {
    await this.#fetchItems(`items?slugs=${encodeURIComponent(id)}`);
    return this.#urls.get(id);
  }

  /** The only door to Klipy: a bare GET, never a header or an address of the user. */
  async #get(url: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(this.#config.timeout_ms),
      });
    } catch (err) {
      this.#log.warn(
        translate("log.gifs.upstream_failure", {
          // the message of a network error may carry the URL, and the key is in it
          reason: err instanceof Error ? err.name : "unknown",
        }),
      );
      // biome-ignore lint/style/useErrorCause: the cause may carry the URL, and the key is in it
      throw new GifsUpstreamError("gifs.upstream_failure");
    }
    if (!response.ok) {
      this.#log.warn(
        translate("log.gifs.upstream_status", {
          status: String(response.status),
        }),
      );
      await response.body?.cancel();
      throw new GifsUpstreamError("gifs.upstream_failure");
    }
    return response;
  }
}
