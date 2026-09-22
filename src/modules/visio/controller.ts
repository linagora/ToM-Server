import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { UNAUTHORIZED } from "../../errors/error-codes";
import { VisioRoomUnavailableError } from "./errors";
import type { VisioService } from "./service";
import type { VisioDeps, VisioRequest, VisioRoom } from "./types";

export const createVisioRoomController = async (
  service: VisioService,
  deps: VisioDeps,
  req: VisioRequest,
  logger: Logger,
): Promise<VisioRoom> => {
  const mxid = req.userId;
  if (!mxid) {
    throw new DomainError(UNAUTHORIZED, "no authenticated user on the request");
  }

  const email = await deps.resolveEmail(req);
  if (!email) {
    const msg = "no email found for user";
    logger.warn(msg, {
      mxid,
    });

    throw new VisioRoomUnavailableError(msg, {
      mxid,
    });
  }

  return service.createRoom(email);
};
