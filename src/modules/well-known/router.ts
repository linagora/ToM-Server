import { Router } from "express";
import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { NOT_FOUND } from "../../errors/error-codes";
import { wellKnownClientController } from "./controller";
import { WellKnownClientService } from "./service";
import type { WellKnownClientSettings } from "./types";

export const createWellKnownClientRouter = (config: WellKnownClientSettings, logger: Logger): Router => {
  const router = Router();
  const service = new WellKnownClientService(config, logger);

  router.get("/.well-known/matrix/client", (_req, res, next) => {
    try {
      if (!config.enabled) {
        logger.info("well-known matrix client route disabled");

        throw new DomainError(NOT_FOUND, "well_known.disabled", {
          route: "/.well-known/matrix/client",
        });
      }

      const document = wellKnownClientController(service);

      if (Object.keys(document).length === 0) {
        logger.info("well-known matrix client document is empty");

        throw new DomainError(NOT_FOUND, "well_known.empty", {
          route: "/.well-known/matrix/client",
        });
      }

      res.json(document);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
