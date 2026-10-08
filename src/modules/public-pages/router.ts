import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { Router as ExpressRouter, Request, Response } from "express";
import express, { Router } from "express";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import {
  baseKey,
  isPublic,
  mediaOf,
  pagePath,
  parseRef,
  REACTION_KEYS,
  REPORT_REASONS,
  readPage,
  renderPage,
  renderRobots,
  renderSitemap,
} from "./pages";
import type { Page, PagesSource, PublicPagesSettings, ReactionStore } from "./types";

/** How long a page is kept before the homeserver is read again. */
const CACHE_MS = 60_000;
const CACHE_MAX = 1000;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // No script runs on a page; images come from this service only
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // The page shows what this visitor reacted with
  "Cache-Control": "private, no-cache",
};
const COOKIE = "tom_visitor";
const READ_LIMIT = 100;
const COMMENT_LIMIT = 500;

/** At most `max` hits per key within `windowMs`. */
const makeLimiter = (max: number, windowMs: number, now: () => number) => {
  const hits = new Map<string, number[]>();

  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);

      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    // ponytail: emptied when large; a periodic sweep if it ever matters
    if (hits.size > 10_000) {
      hits.clear();
    }

    return true;
  };
};

/** What a page may serve as a media: never a document that runs script. */
const isServedMedia = (type: string): boolean =>
  /^(image\/(png|jpeg|gif|webp|avif)|video\/[\w.+-]+|audio\/[\w.+-]+)$/.test(type);

export interface PublicPagesDeps {
  source: PagesSource;
  serverName: string;
  /** Visitor reactions; without it the page has no reactions of visitors and the POST routes answer 404. */
  reactions?: ReactionStore;
  now?: () => number;
}

const notFound = (res: Response): void => {
  res
    .status(404)
    .set(HTML_HEADERS)
    .send('<!doctype html><html lang="en"><title>Not found</title><h1>Not found</h1></html>');
};

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: routes of one router
export const createPublicPagesRouter = (
  settings: PublicPagesSettings,
  { source, serverName, reactions, now = Date.now }: PublicPagesDeps,
  logger: Logger,
): ExpressRouter => {
  const router = Router();
  const publicUrl = settings.public_url.replace(/\/+$/, "");
  const chatUrl = settings.chat_url.replace(/\/+$/, "");
  const secure = publicUrl.startsWith("https:");
  const reactLimit = makeLimiter(30, 60_000, now);
  const reportLimit = makeLimiter(5, 600_000, now);
  const cache = new Map<
    string,
    {
      at: number;
      page: Page | null;
      roomId: string | null;
    }
  >();

  /** The page of a ref, read at most once a minute; null: none to show. The gate runs before any message or media is read. */
  async function pageOf(ref: string): Promise<Page | null> {
    const cached = cache.get(ref);
    if (cached && now() - cached.at < CACHE_MS) {
      return cached.page;
    }
    const parsed = parseRef(ref, serverName);
    const roomId = !parsed ? null : "roomId" in parsed ? parsed.roomId : await source.resolveAlias(parsed.alias);
    const state = roomId ? await source.readState(roomId) : null;
    // ponytail: a cache of 1000 refs, emptied when full; an LRU if it ever matters
    if (cache.size >= CACHE_MAX) {
      cache.clear();
    }
    const page = roomId && state && isPublic(state) ? readPage(ref, state, await source.readMessages(roomId)) : null;
    cache.set(ref, {
      at: now(),
      page,
      roomId,
    });

    return page;
  }

  const cookieOf = (header: string | undefined): string | null => {
    const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{32})(?:;|$)`).exec(header ?? "");

    return match?.[1] ?? null;
  };

  /** The page and room of a POST of a visitor, or null once the answer is sent. */
  async function postTarget(
    req: Request,
    res: Response,
    allow: (ip: string) => boolean,
  ): Promise<{
    page: Page;
    roomId: string;
    eventId: string;
  } | null> {
    if (!allow(req.ip ?? "")) {
      res.status(429).type("text/plain").send("Too many requests.\n");

      return null;
    }
    const ref = String(req.params.ref);
    const page = await pageOf(ref);
    const eventId = typeof req.body?.event_id === "string" ? req.body.event_id : "";
    const roomId = cache.get(ref)?.roomId ?? "";
    if (!page || !page.posts.some((post) => post.id === eventId)) {
      notFound(res);

      return null;
    }

    return {
      page,
      roomId,
      eventId,
    };
  }

  const backTo = (res: Response, ref: string, eventId: string, query = ""): void => {
    res.redirect(303, `${pagePath(ref)}${query}#post-${encodeURIComponent(eventId)}`);
  };

  const upstreamFailed = (res: Response, err: unknown): void => {
    logger.warn(
      translate("log.public_pages.failed", {
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    res.status(502).type("text/plain").send("The homeserver did not answer.\n");
  };

  router.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(renderRobots(publicUrl));
  });

  router.get("/sitemap.xml", async (_req, res) => {
    try {
      const rooms = await source.listRooms();
      res.set("Cache-Control", "public, max-age=300").type("application/xml").send(
        renderSitemap(rooms, {
          publicUrl,
          serverName,
        }),
      );
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  router.get("/b/:ref", async (req, res) => {
    try {
      const page = await pageOf(req.params.ref);
      if (!page) {
        notFound(res);
        return;
      }
      const roomId = cache.get(req.params.ref)?.roomId ?? "";
      const ids = page.posts.map((post) => post.id);
      const visitorId = cookieOf(req.headers.cookie);
      const [counts, mine] = reactions
        ? await Promise.all([
            reactions.counts(roomId, ids),
            visitorId ? reactions.mine(roomId, ids, visitorId) : {},
          ])
        : [
            {},
            {},
          ];
      res
        .status(200)
        .set(HTML_HEADERS)
        .send(
          renderPage(page, {
            publicUrl,
            chatUrl,
            lang: settings.lang,
            visitor: {
              counts,
              mine,
            },
            reported: req.query.reported === "1",
          }),
        );
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  const form = express.urlencoded({
    extended: false,
    limit: "8kb",
  });

  router.post("/b/:ref/react", form, async (req, res) => {
    try {
      const target = reactions ? await postTarget(req, res, reactLimit) : null;
      if (!reactions || !target) {
        if (!reactions) {
          notFound(res);
        }
        return;
      }
      const key = REACTION_KEYS.find((candidate) => baseKey(candidate) === baseKey(String(req.body.key ?? "")));
      if (!key) {
        res.status(400).type("text/plain").send("Unknown reaction.\n");
        return;
      }
      const visitorId = cookieOf(req.headers.cookie) ?? randomBytes(16).toString("hex");
      await reactions.toggle(target.roomId, target.eventId, key, visitorId);
      cache.delete(req.params.ref);
      res.cookie(COOKIE, visitorId, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/b/",
        maxAge: 365 * 24 * 3600 * 1000,
      });
      backTo(res, req.params.ref, target.eventId);
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  router.post("/b/:ref/report", form, async (req, res) => {
    try {
      const target = await postTarget(req, res, reportLimit);
      if (!target) {
        return;
      }
      const reason = REPORT_REASONS.find((candidate) => candidate === req.body.reason);
      if (!reason) {
        res.status(400).type("text/plain").send("Unknown reason.\n");
        return;
      }
      // Only the reason and the comment: never the IP or the cookie of the visitor
      const comment = (typeof req.body.comment === "string" ? req.body.comment : "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, COMMENT_LIMIT);
      await source.report(
        target.roomId,
        target.eventId,
        `Public page visitor: ${reason}${comment ? `: ${comment}` : ""}`,
      );
      backTo(res, req.params.ref, target.eventId, "?reported=1");
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  /** Visitor counts for the members of Twake Chat; public data, so any origin may read it. */
  router.get("/_twake/v1/public-pages/reactions", async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const roomId = req.query.room_id;
    const ids = [
      req.query.event_id ?? [],
    ]
      .flat()
      .filter((id): id is string => typeof id === "string");
    if (typeof roomId !== "string" || roomId.length > 255 || ids.length > READ_LIMIT) {
      res.status(400).json({
        errcode: "M_INVALID_PARAM",
      });
      return;
    }
    try {
      const state = await source.readState(roomId);
      if (!state || !isPublic(state)) {
        res.status(404).json({
          errcode: "M_NOT_FOUND",
        });
        return;
      }
      const counts = reactions ? await reactions.counts(roomId, ids) : {};
      res.json({
        reactions: Object.fromEntries(
          ids.map((id) => [
            id,
            counts[id] ?? {},
          ]),
        ),
      });
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one guard per refusal
  router.get("/b/:ref/media/:server/:id", async (req, res) => {
    const { ref, server, id } = req.params;
    try {
      const page = await pageOf(ref);
      // Only what the page shows: never any media of the homeserver
      if (!page || !/^[A-Za-z0-9_-]+$/.test(id) || !mediaOf(page).has(`mxc://${server}/${id}`)) {
        notFound(res);
        return;
      }
      const upstream = await source.download(server, id);
      const type = upstream.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!upstream.ok || !upstream.body || !isServedMedia(type)) {
        notFound(res);
        return;
      }
      res.status(200).set({
        "Content-Type": type,
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      });
      const body = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
      body.on("error", () => res.destroy());
      body.pipe(res);
    } catch (err) {
      upstreamFailed(res, err);
    }
  });

  return router;
};
