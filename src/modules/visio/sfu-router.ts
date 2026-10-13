import { Router } from "express";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { VisioRoomUnavailableError } from "./errors";
import { sfuGetController } from "./sfu-controller";
import type { SfuDeps } from "./types";

/** `livekit_service_url` of the well-known is this path; MatrixRTC appends `/sfu/get`. */
export const SFU_ROUTE = "/_twake/v1/video_call/sfu/get";

export const createSfuRouter = (deps: SfuDeps | undefined, logger: Logger): Router => {
  const router = Router();

  if (!deps) {
    router.post(SFU_ROUTE, (_req, _res, next) => {
      logger.info(translate("log.visio.sfu_disabled"));

      next(
        new VisioRoomUnavailableError("visio.sfu_disabled", {
          route: SFU_ROUTE,
        }),
      );
    });

    return router;
  }

  router.post(SFU_ROUTE, async (req, res, next) => {
    try {
      res.json(await sfuGetController(req.body, deps, logger));
    } catch (err) {
      next(err);
    }
  });

  return router;
};
