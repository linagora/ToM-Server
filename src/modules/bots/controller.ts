import { DomainError } from "../../errors/domain-error";
import { UNAUTHORIZED } from "../../errors/error-codes";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import type { BotsService } from "./service";
import type { MyBot } from "./types";

export const myBotController = (service: BotsService, req: AuthenticatedRequest): Promise<MyBot> => {
  if (!req.userId || !req.accessToken) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  return service.provision(req.userId, req.accessToken);
};
