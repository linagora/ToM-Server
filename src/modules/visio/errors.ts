import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, FORBIDDEN, NOT_FOUND, UNAUTHORIZED, UNPROCESSABLE } from "../../errors/error-codes";

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

/** The OpenID token of the MatrixRTC request was rejected by the homeserver. */
export class VisioOpenIdError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(UNAUTHORIZED, messageKey, context);
  }
}

/** The user is not a member of the room, or belongs to another homeserver. */
export class VisioForbiddenError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(FORBIDDEN, messageKey, context);
  }
}
