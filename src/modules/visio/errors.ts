import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, NOT_FOUND } from "../../errors/error-codes";

export class VisioRoomUnavailableError extends DomainError {
  constructor(reason: string, context: Record<string, unknown> = {}) {
    super(NOT_FOUND, reason, context);
  }
}

export class VisioUpstreamError extends DomainError {
  constructor(reason: string, context: Record<string, unknown> = {}) {
    super(BAD_GATEWAY, reason, context);
  }
}
