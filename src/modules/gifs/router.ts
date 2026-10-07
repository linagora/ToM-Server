import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT, UNAUTHORIZED } from "../../errors/error-codes";
import { translate } from "../../i18n/index";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { GifsDisabledError } from "./errors";
import { mediaParamsSchema, searchQuerySchema, switchRequestSchema, trendingQuerySchema } from "./schema";
import type { GifsService } from "./service";
import { MEDIA_ROUTE } from "./service";
import type { GifsDeps } from "./types";

export const STATUS_ROUTE = "/_twake/v1/gifs/status";
export const SEARCH_ROUTE = "/_twake/v1/gifs/search";
export const TRENDING_ROUTE = "/_twake/v1/gifs/trending";
export const ADMIN_ROUTE = "/_twake/v1/admin/features/gifs";

type Handler = (req: Request, res: Response) => Promise<void>;

const handle =
  (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

const parse = <Output>(
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: Output;
    };
  },
  value: unknown,
): Output => {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new DomainError(INVALID_INPUT, "gifs.invalid_request");
  }
  return result.data;
};

const userOf = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    throw new DomainError(UNAUTHORIZED, "gifs.no_authenticated_user");
  }
  return userId;
};

/**
 * Without a key (`service` undefined) the feature does not exist: 404 everywhere, and the
 * status says so. Otherwise the switch decides, at run time (`GifsService.isAvailable`).
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: One flat list of routes
export const createGifsRouter = (
  deps: GifsDeps | undefined,
  service: GifsService | undefined,
  logger: Logger,
): Router => {
  const router = Router();

  if (!deps || !service) {
    router.get(STATUS_ROUTE, (_req, res) => {
      res.json({
        enabled: false,
      });
    });
    router.all(
      [
        SEARCH_ROUTE,
        TRENDING_ROUTE,
        `${MEDIA_ROUTE}/:id/:variant`,
        ADMIN_ROUTE,
      ],
      (_req, _res, next) => {
        logger.info(translate("log.gifs.disabled"));
        next(new GifsDisabledError("gifs.disabled"));
      },
    );
    return router;
  }

  router.get(
    STATUS_ROUTE,
    deps.authenticate,
    handle(async (_req, res) => {
      res.json({
        enabled: await service.isAvailable(),
      });
    }),
  );

  router.get(
    SEARCH_ROUTE,
    deps.authenticate,
    deps.rateLimit,
    handle(async (req, res) => {
      const query = parse(searchQuerySchema, req.query);
      res.json(await service.search(userOf(req), query.q, query.page, query.locale));
    }),
  );

  router.get(
    TRENDING_ROUTE,
    deps.authenticate,
    deps.rateLimit,
    handle(async (req, res) => {
      const query = parse(trendingQuerySchema, req.query);
      res.json(await service.trending(userOf(req), query.page, query.locale));
    }),
  );

  // Signed by `search` and `trending`, so that an <img> can load it without a header
  router.get(
    `${MEDIA_ROUTE}/:id/:variant`,
    handle(async (req, res) => {
      const params = parse(mediaParamsSchema, {
        ...req.params,
        ...req.query,
      });
      const media = await service.media(params.id, params.variant, params.exp, params.sig);
      res.set({
        "Content-Type": media.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
      });
      try {
        // biome-ignore lint/suspicious/noExplicitAny: DOM and node:stream/web ReadableStream types differ
        await pipeline(Readable.fromWeb(media.body as any), res);
      } catch {
        // Too large, or the CDN failed halfway: the headers are gone, cut the connection
        logger.warn(translate("log.gifs.media_aborted"));
        res.destroy();
      }
    }),
  );

  router.get(
    ADMIN_ROUTE,
    deps.authenticateAdmin,
    handle(async (_req, res) => {
      res.json(await adminState(service));
    }),
  );

  router.put(
    ADMIN_ROUTE,
    deps.authenticateAdmin,
    handle(async (req, res) => {
      await service.setSwitch(parse(switchRequestSchema, req.body).enabled);
      res.json(await adminState(service));
    }),
  );

  return router;
};

/** `enabled` is the switch; `available` is what the clients get (the key must be there too). */
const adminState = async (
  service: GifsService,
): Promise<{
  enabled: boolean;
  available: boolean;
}> => ({
  enabled: await service.switchValue(),
  available: await service.isAvailable(),
});
