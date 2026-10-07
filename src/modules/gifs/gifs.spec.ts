import { beforeAll, describe, expect, it } from "bun:test";

import type { RequestHandler } from "express";
import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { errorMiddleware } from "../../errors/error-middleware";
import { loadMessages } from "../../i18n/index";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import Database from "../legacy/db/database";
import { DbGifsFlag, FLAGS_SCHEMA } from "./flag";
import { createGifsRouter } from "./router";
import { gifsSettingsSchema } from "./schema";
import { GifsService } from "./service";
import type { GifsDeps, GifsFlag } from "./types";

const silentLogger = createLogger({
  silent: true,
});
const USER = "@dwho:example.com";
const KEY = "test-key-not-real";
const ADMIN = "admin-token";

const file = (name: string, w = 100, h = 50): Record<string, unknown> => ({
  url: `https://static.klipy.com/ii/${name}`,
  width: w,
  height: h,
  size: 1,
});
const item = (slug: string): Record<string, unknown> => ({
  id: 1,
  slug,
  title: `title ${slug}`,
  file: {
    hd: {
      gif: file(`${slug}-hd.gif`, 400, 200),
    },
    md: {
      gif: file(`${slug}-md.gif`, 200, 100),
      webp: file(`${slug}-md.webp`),
    },
    sm: {
      webp: file(`${slug}-sm.webp`, 50, 25),
    },
  },
});

interface Call {
  url: string;
  init?: RequestInit;
}

const makeFetch = (calls: Call[], media?: () => Response): typeof fetch => {
  const respond = (input: string | URL | Request, init?: RequestInit): Response => {
    const url = String(input);
    calls.push({
      url,
      init,
    });
    if (url.startsWith("https://static.klipy.com/")) {
      return (
        media?.() ??
        new Response("GIF89a", {
          headers: {
            "content-type": "image/gif",
          },
        })
      );
    }
    return Response.json({
      result: true,
      data: {
        data: [
          item("one"),
          {
            slug: "bad slug!",
            file: {},
          },
          {
            slug: "evil",
            file: {
              md: {
                gif: file("x.gif"),
              },
            },
          },
        ].map((entry) =>
          entry.slug === "evil"
            ? {
                ...entry,
                file: {
                  md: {
                    gif: {
                      url: "https://evil.example.com/x.gif",
                      width: 1,
                      height: 1,
                    },
                  },
                },
              }
            : entry,
        ),
        has_next: true,
      },
    });
  };
  return ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respond(input, init))) as unknown as typeof fetch;
};

const memoryFlag = (initial?: boolean): GifsFlag => {
  let value = initial;
  return {
    get: () => Promise.resolve(value),
    set: (enabled: boolean) => {
      value = enabled;
      return Promise.resolve();
    },
  };
};

const settings = (over: Record<string, unknown> = {}): ReturnType<typeof gifsSettingsSchema.parse> =>
  gifsSettingsSchema.parse({
    enabled: true,
    klipy_api_key: KEY,
    ...over,
  });

const makeService = (
  calls: Call[],
  flag: GifsFlag = memoryFlag(),
  over: Record<string, unknown> = {},
  media?: () => Response,
): GifsService =>
  new GifsService(settings(over), flag, "https://tom.example.com/", silentLogger, makeFetch(calls, media));

const authenticate: RequestHandler = (req: AuthenticatedRequest, _res, next): void => {
  req.userId = USER;
  next();
};
const passThrough: RequestHandler = (_req, _res, next): void => next();
const adminCheck: RequestHandler = (req, res, next): void => {
  if (req.headers.authorization === `Bearer ${ADMIN}`) {
    next();
  } else {
    res.status(403).json({});
  }
};
const deps: GifsDeps = {
  authenticate,
  rateLimit: passThrough,
  authenticateAdmin: adminCheck,
};

const makeApp = (service: GifsService | undefined): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(createGifsRouter(service ? deps : undefined, service, silentLogger));
  app.use(
    errorMiddleware({
      locale: "en",
    } as never),
  );
  return app;
};

beforeAll(() => {
  loadMessages(undefined, silentLogger);
});

describe("gifs settings", () => {
  it("is off by default, with the Klipy URL", () => {
    const parsed = gifsSettingsSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.klipy_api_key).toBe("");
    expect(parsed.klipy_base_url).toBe("https://api.klipy.com");
  });
});

describe("switch in the database", () => {
  it("is undefined, then stored, then updated", async () => {
    const db = new Database<"feature_flags">(
      {
        database_engine: "sqlite",
        database_host: ":memory:",
        database_vacuum_delay: 0,
      },
      silentLogger as never,
      FLAGS_SCHEMA,
    );
    await db.ready;
    const flag = new DbGifsFlag(db);
    expect(await flag.get()).toBeUndefined();
    await flag.set(true);
    expect(await flag.get()).toBe(true);
    await flag.set(false);
    expect(await flag.get()).toBe(false);
  });
});

describe("GifsService availability", () => {
  it("needs the key, whatever the switch says", async () => {
    const service = makeService([], memoryFlag(true), {
      klipy_api_key: "",
    });
    expect(await service.isAvailable()).toBe(false);
  });

  it("follows the config, then the stored switch over it", async () => {
    const service = makeService([], memoryFlag(), {
      enabled: false,
    });
    expect(await service.isAvailable()).toBe(false);
    await service.setSwitch(true);
    expect(await service.isAvailable()).toBe(true);
    const off = makeService([], memoryFlag(false), {
      enabled: true,
    });
    expect(await off.isAvailable()).toBe(false);
  });
});

describe("GifsService search", () => {
  it("calls Klipy with a hashed customer id and nothing of the user", async () => {
    const calls: Call[] = [];
    const page = await makeService(calls).search(USER, "cat", 2, "fr-FR");

    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(`https://api.klipy.com/api/v1/${KEY}/gifs/search`);
    expect(url.searchParams.get("q")).toBe("cat");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("locale")).toBe("fr");
    expect(url.searchParams.get("customer_id")).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]?.url).not.toContain("dwho");
    expect(calls[0]?.init?.headers).toBeUndefined();

    expect(page.next_page).toBe(3);
    expect(page.results).toHaveLength(1);
    expect(page.results[0]).toMatchObject({
      id: "one",
      title: "title one",
      width: 200,
      height: 100,
    });
    expect(page.results[0]?.url).toStartWith("https://tom.example.com/_twake/v1/gifs/media/one/full?exp=");
    expect(page.results[0]?.preview_url).toContain("/media/one/preview?exp=");
    expect(JSON.stringify(page)).not.toContain("klipy.com");
  });

  it("is a 404 when the feature is off", async () => {
    const service = makeService([], memoryFlag(false));
    await expect(service.search(USER, "cat", 1)).rejects.toMatchObject({
      code: "M_NOT_FOUND",
    });
  });

  it("is a 502 when Klipy fails", async () => {
    const service = new GifsService(
      settings(),
      memoryFlag(),
      "",
      silentLogger,
      (async () =>
        new Response("no", {
          status: 500,
        })) as unknown as typeof fetch,
    );
    await expect(service.search(USER, "cat", 1)).rejects.toMatchObject({
      code: "M_BAD_GATEWAY",
    });
  });
});

describe("GifsService trending", () => {
  it("is cached for a short time", async () => {
    const calls: Call[] = [];
    const service = makeService(calls);
    await service.trending(USER, 1);
    await service.trending("@other:example.com", 1);
    expect(calls).toHaveLength(1);
    await service.trending(USER, 2);
    expect(calls).toHaveLength(2);
  });
});

describe("GifsService media", () => {
  const signed = async (
    service: GifsService,
  ): Promise<{
    id: string;
    variant: "full";
    exp: number;
    sig: string;
  }> => {
    const page = await service.search(USER, "cat", 1);
    const url = new URL(page.results[0]?.url ?? "");
    return {
      id: "one",
      variant: "full",
      exp: Number(url.searchParams.get("exp")),
      sig: url.searchParams.get("sig") ?? "",
    };
  };

  it("streams the file of the CDN, without header of the user", async () => {
    const calls: Call[] = [];
    const service = makeService(calls);
    const m = await signed(service);
    const media = await service.media(m.id, m.variant, m.exp, m.sig);
    expect(media.contentType).toBe("image/gif");
    expect(await new Response(media.body).text()).toBe("GIF89a");
    expect(calls.at(-1)?.url).toBe("https://static.klipy.com/ii/one-md.gif");
    expect(calls.at(-1)?.init?.headers).toBeUndefined();
  });

  it("refuses a bad or expired signature, and another id", async () => {
    const service = makeService([]);
    const m = await signed(service);
    await expect(service.media(m.id, m.variant, m.exp, "0".repeat(64))).rejects.toMatchObject({
      code: "M_FORBIDDEN",
    });
    await expect(service.media("two", m.variant, m.exp, m.sig)).rejects.toMatchObject({
      code: "M_FORBIDDEN",
    });
    const old = Math.floor(Date.now() / 1000) - 10;
    const forged = new URL((await service.search(USER, "cat", 1)).results[0]?.url ?? "");
    await expect(service.media(m.id, m.variant, old, forged.searchParams.get("sig") ?? "")).rejects.toMatchObject({
      code: "M_FORBIDDEN",
    });
  });

  it("refuses a content type that is not an image or a video", async () => {
    const service = makeService(
      [],
      memoryFlag(),
      {},
      () =>
        new Response("<html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
    );
    const m = await signed(service);
    await expect(service.media(m.id, m.variant, m.exp, m.sig)).rejects.toMatchObject({
      code: "M_BAD_GATEWAY",
    });
  });

  it("refuses a file above the cap, declared or not", async () => {
    const declared = makeService(
      [],
      memoryFlag(),
      {
        max_media_bytes: 3,
      },
      () =>
        new Response("GIF89a", {
          headers: {
            "content-type": "image/gif",
            "content-length": "6",
          },
        }),
    );
    const d = await signed(declared);
    await expect(declared.media(d.id, d.variant, d.exp, d.sig)).rejects.toMatchObject({
      code: "M_BAD_GATEWAY",
    });

    const hidden = makeService(
      [],
      memoryFlag(),
      {
        max_media_bytes: 3,
      },
      () =>
        new Response(
          new Blob([
            "GIF89a",
          ]).stream(),
          {
            headers: {
              "content-type": "image/gif",
            },
          },
        ),
    );
    const h = await signed(hidden);
    const media = await hidden.media(h.id, h.variant, h.exp, h.sig);
    await expect(new Response(media.body).text()).rejects.toThrow();
  });

  it("asks Klipy again for a GIF the cache forgot", async () => {
    const calls: Call[] = [];
    const first = makeService(calls);
    const m = await signed(first);
    // another instance: same key, empty cache
    const second = makeService(calls);
    const media = await second.media(m.id, m.variant, m.exp, m.sig);
    expect(await new Response(media.body).text()).toBe("GIF89a");
    expect(calls.some((c) => c.url.includes("/gifs/items?slugs=one"))).toBe(true);
  });
});

describe("gifs router", () => {
  it("serves search, trending and status", async () => {
    const app = makeApp(makeService([]));
    const search = await request(app).get("/_twake/v1/gifs/search?q=cat&page=1&locale=fr");
    expect(search.status).toBe(200);
    expect(Object.keys(search.body.results[0]).sort()).toEqual([
      "height",
      "id",
      "preview_url",
      "title",
      "url",
      "width",
    ]);
    expect(search.body.next_page).toBe(2);
    expect((await request(app).get("/_twake/v1/gifs/trending")).status).toBe(200);
    expect((await request(app).get("/_twake/v1/gifs/status")).body).toEqual({
      enabled: true,
    });
  });

  it("rejects a search without q", async () => {
    const res = await request(makeApp(makeService([]))).get("/_twake/v1/gifs/search");
    expect(res.status).toBe(400);
    expect(res.body.errcode).toBe("M_INVALID_PARAM");
  });

  it("answers 404 M_NOT_FOUND when the switch is off, status says false", async () => {
    const app = makeApp(makeService([], memoryFlag(false)));
    const res = await request(app).get("/_twake/v1/gifs/search?q=cat");
    expect(res.status).toBe(404);
    expect(res.body.errcode).toBe("M_NOT_FOUND");
    expect((await request(app).get("/_twake/v1/gifs/trending")).status).toBe(404);
    expect((await request(app).get("/_twake/v1/gifs/status")).body).toEqual({
      enabled: false,
    });
  });

  it("answers 404 everywhere without a key", async () => {
    const app = makeApp(undefined);
    expect((await request(app).get("/_twake/v1/gifs/search?q=cat")).status).toBe(404);
    expect((await request(app).get("/_twake/v1/admin/features/gifs")).status).toBe(404);
    expect((await request(app).get("/_twake/v1/gifs/status")).body).toEqual({
      enabled: false,
    });
  });

  it("proxies the media and refuses a bad signature", async () => {
    const app = makeApp(makeService([]));
    const page = await request(app).get("/_twake/v1/gifs/search?q=cat");
    const url = new URL(page.body.results[0].preview_url);
    const ok = await request(app)
      .get(url.pathname + url.search)
      .buffer(true);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/gif");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.body.toString()).toBe("GIF89a");

    const bad = await request(app).get(`${url.pathname}?exp=${url.searchParams.get("exp")}&sig=${"a".repeat(64)}`);
    expect(bad.status).toBe(403);
    expect((await request(app).get(url.pathname)).status).toBe(400);
  });

  it("lets the admin read and change the switch, and nobody else", async () => {
    const app = makeApp(
      makeService([], memoryFlag(), {
        enabled: false,
      }),
    );
    expect((await request(app).get("/_twake/v1/admin/features/gifs")).status).toBe(403);
    const auth = {
      Authorization: `Bearer ${ADMIN}`,
    };
    expect((await request(app).get("/_twake/v1/admin/features/gifs").set(auth)).body).toEqual({
      enabled: false,
      available: false,
    });
    const put = await request(app).put("/_twake/v1/admin/features/gifs").set(auth).send({
      enabled: true,
    });
    expect(put.body).toEqual({
      enabled: true,
      available: true,
    });
    expect((await request(app).get("/_twake/v1/gifs/status")).body.enabled).toBe(true);
    const bad = await request(app).put("/_twake/v1/admin/features/gifs").set(auth).send({
      enabled: "yes",
    });
    expect(bad.status).toBe(400);
  });
});
