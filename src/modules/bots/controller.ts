import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT, UNAUTHORIZED } from "../../errors/error-codes";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { BotNotFoundError } from "./errors";
import { homeRequestSchema, myBotRequestSchema } from "./schema";
import type { BotsProvisioner, MyBot } from "./types";

export const myBotController = (service: BotsProvisioner, req: AuthenticatedRequest): Promise<MyBot> => {
  if (!req.userId || !req.accessToken) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  const body = myBotRequestSchema.safeParse(req.body ?? {});
  return service.provision(req.userId, req.accessToken, body.success ? body.data.timezone : undefined);
};

export const myBotFindController = async (service: BotsProvisioner, req: AuthenticatedRequest): Promise<MyBot> => {
  if (!req.userId || !req.accessToken) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  const bot = await service.find(req.userId, req.accessToken);
  if (bot === null) {
    throw new BotNotFoundError("bots.not_found");
  }
  return bot;
};

export const myBotHomeController = async (service: BotsProvisioner, req: AuthenticatedRequest): Promise<void> => {
  if (!req.userId) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  const body = homeRequestSchema.safeParse(req.body);
  if (!body.success) {
    throw new DomainError(INVALID_INPUT, "bots.invalid_room");
  }
  await service.setHome(req.userId, body.data.room_id);
};

export const myBotRecoverController = async (service: BotsProvisioner, req: AuthenticatedRequest): Promise<void> => {
  if (!req.userId) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  await service.recover(req.userId);
};
