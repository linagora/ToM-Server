import { Router } from "express";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { myBotController, myBotHomeController } from "./controller";
import { BotsDisabledError } from "./errors";
import type { BotsService } from "./service";
import type { BotsDeps, BotsSettings } from "./types";

export const MY_BOT_ROUTE = "/_twake/v1/bots/me";
export const MY_BOT_HOME_ROUTE = "/_twake/v1/bots/me/home";

export const createBotsRouter = (
  config: BotsSettings,
  deps: BotsDeps | undefined,
  service: BotsService | undefined,
  logger: Logger,
): Router => {
  const router = Router();

  if (!config.enabled || !deps || !service) {
    router.post(
      [
        MY_BOT_ROUTE,
        MY_BOT_HOME_ROUTE,
      ],
      (_req, _res, next) => {
        logger.info(translate("log.bots.disabled"));
        next(
          new BotsDisabledError("bots.disabled", {
            route: MY_BOT_ROUTE,
          }),
        );
      },
    );
    return router;
  }

  router.post(MY_BOT_ROUTE, deps.authenticate, async (req, res, next) => {
    try {
      res.status(200).json(await myBotController(service, req));
    } catch (err) {
      next(err);
    }
  });

  router.post(MY_BOT_HOME_ROUTE, deps.authenticate, (req, res, next) => {
    try {
      myBotHomeController(service, req);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
