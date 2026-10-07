import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, NOT_FOUND, SERVICE_UNAVAILABLE, UNPROCESSABLE } from "../../errors/error-codes";

/** The feature is off: the client hides its action (404). */
export class BotsDisabledError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(NOT_FOUND, messageKey, context);
  }
}

/** The user has no assistant yet: `bots/me` first (404). */
export class BotNotProvisionedError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(NOT_FOUND, messageKey, context);
  }
}

/** The bot is provisioned but its keys are not published yet: try again later (503). */
export class BotNotReadyError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(SERVICE_UNAVAILABLE, messageKey, context);
  }
}

/** The agent harness serves no assistant for this user: not on its homeserver (422). */
export class BotOwnerNotServedError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(UNPROCESSABLE, messageKey, context);
  }
}

/** The harness refuses the room as the home of the bot: someone else is in it (422). */
export class BotHomeRefusedError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(UNPROCESSABLE, messageKey, context);
  }
}

/** The identity of the bot waits for its owner's recovery at the harness: retrying does not help (422). */
export class BotRecoveryNeededError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(UNPROCESSABLE, messageKey, context);
  }
}

/** The homeserver failed or cannot be reached (502). */
export class BotsUpstreamError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(BAD_GATEWAY, messageKey, context);
  }
}
