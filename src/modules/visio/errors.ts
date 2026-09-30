import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, NOT_FOUND, UNPROCESSABLE } from "../../errors/error-codes";

export class VisioRoomUnavailableError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(NOT_FOUND, messageKey, context);
  }
}

export class VisioUpstreamError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(BAD_GATEWAY, messageKey, context);
  }
}

export class VisioEmailUnresolvableError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(UNPROCESSABLE, messageKey, context);
  }
}
