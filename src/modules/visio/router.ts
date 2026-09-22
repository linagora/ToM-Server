import { Router } from "express";
import type { Logger } from "winston";

import { createVisioRoomController } from "./controller";
import { VisioRoomUnavailableError } from "./errors";
import { VisioService } from "./service";
import type { VisioDeps, VisioSettings } from "./types";

const ROUTE = "/_twake/v1/video_call/rooms";

export const createVisioRouter = (config: VisioSettings, deps: VisioDeps | undefined, logger: Logger): Router => {
  const router = Router();

  if (!config.enabled || !deps) {
    router.post(ROUTE, (_req, _res, next) => {
      const msg = "video call room creation disabled";
      logger.info(msg);

      next(
        new VisioRoomUnavailableError(msg, {
          route: ROUTE,
        }),
      );
    });

    return router;
  }

  const service = new VisioService(config, logger);

  router.post(ROUTE, deps.authenticate, async (req, res, next) => {
    try {
      const room = await createVisioRoomController(service, deps, req, logger);

      res.status(201).json(room);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
