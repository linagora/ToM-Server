import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { UNAUTHORIZED } from "../../errors/error-codes";
import { translate } from "../../i18n/index";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { VisioEmailUnresolvableError } from "./errors";
import type { VisioService } from "./service";
import type { VisioDeps, VisioRoom } from "./types";

export const createVisioRoomController = async (
  service: VisioService,
  deps: VisioDeps,
  req: AuthenticatedRequest,
  logger: Logger,
): Promise<VisioRoom> => {
  const mxid = req.userId;
  if (!mxid) {
    throw new DomainError(UNAUTHORIZED, "visio.no_authenticated_user");
  }

  const email = await deps.resolveEmail(req);
  if (!email) {
    logger.warn(translate("log.visio.email_unresolvable"), {
      mxid,
    });

    throw new VisioEmailUnresolvableError("visio.email_unresolvable", {
      mxid,
    });
  }

  return service.createRoom(email);
};
