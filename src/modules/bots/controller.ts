import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT, UNAUTHORIZED } from "../../errors/error-codes";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { homeRequestSchema, myBotRequestSchema } from "./schema";
import type { BotsService } from "./service";
import type { MyBot } from "./types";

export const myBotController = (service: BotsService, req: AuthenticatedRequest): Promise<MyBot> => {
  if (!req.userId || !req.accessToken) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  const body = myBotRequestSchema.safeParse(req.body ?? {});
  return service.provision(req.userId, req.accessToken, body.success ? body.data.timezone : undefined);
};

export const myBotHomeController = (service: BotsService, req: AuthenticatedRequest): void => {
  if (!req.userId) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  const body = homeRequestSchema.safeParse(req.body);
  if (!body.success) {
    throw new DomainError(INVALID_INPUT, "bots.invalid_room");
  }
  service.setHome(req.userId, body.data.room_id);
};
