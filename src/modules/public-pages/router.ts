import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { Router as ExpressRouter, Response } from "express";
import { Router } from "express";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { isPublic, mediaOf, parseRef, readPage, renderPage, renderRobots, renderSitemap } from "./pages";
import type { Page, PagesSource, PublicPagesSettings } from "./types";

/** How long a page is kept before the homeserver is read again. */
const CACHE_MS = 60_000;
const CACHE_MAX = 1000;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // No script runs on a page; images come from this service only
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "public, max-age=60",
};

/** What a page may serve as a media: never a document that runs script. */
const isServedMedia = (type: string): boolean =>
  /^(image\/(png|jpeg|gif|webp|avif)|video\/[\w.+-]+|audio\/[\w.+-]+)$/.test(type);

export interface PublicPagesDeps {
  source: PagesSource;
  serverName: string;
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
  { source, serverName, now = Date.now }: PublicPagesDeps,
  logger: Logger,
): ExpressRouter => {
  const router = Router();
  const publicUrl = settings.public_url.replace(/\/+$/, "");
  const chatUrl = settings.chat_url.replace(/\/+$/, "");
  const cache = new Map<
    string,
    {
      at: number;
      page: Page | null;
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
    });

    return page;
  }

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
      res
        .status(200)
        .set(HTML_HEADERS)
        .send(
          renderPage(page, {
            publicUrl,
            chatUrl,
            lang: settings.lang,
          }),
        );
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
