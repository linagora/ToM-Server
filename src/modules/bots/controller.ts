import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT, UNAUTHORIZED } from "../../errors/error-codes";
import type { AuthenticatedRequest } from "../../middleware/auth/types";
import { BotNotFoundError, BotsDisabledError } from "./errors";
import { homeRequestSchema, myBotRequestSchema, suggestionsSchema } from "./schema";
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

/** The owner's switch of the suggestions; a backend without them answers as assistants that are off (404). */
export const mySuggestionsController = async (
  service: BotsProvisioner,
  req: AuthenticatedRequest,
): Promise<{
  enabled: boolean;
}> => {
  if (!req.userId) {
    throw new DomainError(UNAUTHORIZED, "bots.no_authenticated_user");
  }
  if (!service.readSuggestions || !service.writeSuggestions) {
    throw new BotsDisabledError("bots.suggestions_unavailable");
  }
  if (req.method === "GET") {
    return {
      enabled: await service.readSuggestions(req.userId),
    };
  }
  const body = suggestionsSchema.safeParse(req.body);
  if (!body.success) {
    throw new DomainError(INVALID_INPUT, "bots.invalid_suggestions");
  }
  return {
    enabled: await service.writeSuggestions(req.userId, body.data.enabled),
  };
};
