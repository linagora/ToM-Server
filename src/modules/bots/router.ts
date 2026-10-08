import { type NextFunction, type Request, type Response, Router } from "express";
import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { myBotController, myBotFindController, myBotHomeController, myBotRecoverController } from "./controller";
import { BotsDisabledError } from "./errors";
import type { BotsDeps, BotsProvisioner, BotsSettings } from "./types";

export const MY_BOT_ROUTE = "/_twake/v1/bots/me";
export const MY_BOT_HOME_ROUTE = "/_twake/v1/bots/me/home";
export const MY_BOT_RECOVER_ROUTE = "/_twake/v1/bots/me/recover";

export const createBotsRouter = (
  config: BotsSettings,
  deps: BotsDeps | undefined,
  service: BotsProvisioner | undefined,
  logger: Logger,
): Router => {
  const router = Router();

  if (!config.enabled || !deps || !service) {
    const disabled = (_req: Request, _res: Response, next: NextFunction): void => {
      logger.info(translate("log.bots.disabled"));
      next(
        new BotsDisabledError("bots.disabled", {
          route: MY_BOT_ROUTE,
        }),
      );
    };
    router.get(MY_BOT_ROUTE, disabled);
    router.post(
      [
        MY_BOT_ROUTE,
        MY_BOT_HOME_ROUTE,
        MY_BOT_RECOVER_ROUTE,
      ],
      disabled,
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

  router.get(MY_BOT_ROUTE, deps.authenticate, async (req, res, next) => {
    try {
      res.status(200).json(await myBotFindController(service, req));
    } catch (err) {
      next(err);
    }
  });

  router.post(MY_BOT_HOME_ROUTE, deps.authenticate, async (req, res, next) => {
    try {
      await myBotHomeController(service, req);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post(MY_BOT_RECOVER_ROUTE, deps.authenticate, async (req, res, next) => {
    try {
      await myBotRecoverController(service, req);
      res.status(202).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
