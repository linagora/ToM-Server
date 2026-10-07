import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, FORBIDDEN, NOT_FOUND } from "../../errors/error-codes";

/** The feature is off, or its key is missing: the client hides its action (404). */
export class GifsDisabledError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(NOT_FOUND, messageKey, context);
  }
}

/** Klipy failed, or its media is not one we serve (502). */
export class GifsUpstreamError extends DomainError {
  constructor(messageKey: string, context: Record<string, unknown> = {}) {
    super(BAD_GATEWAY, messageKey, context);
  }
}

/** A media URL with a wrong or expired signature (403). */
export class GifsSignatureError extends DomainError {
  constructor(messageKey: string) {
    super(FORBIDDEN, messageKey);
  }
}
