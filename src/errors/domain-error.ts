import type { ErrorCode } from "./error-codes";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly context: Record<string, unknown>;

  /** `messageKey` is the i18n key of the message sent to the client. */
  constructor(code: ErrorCode, messageKey: string, context: Record<string, unknown> = {}) {
    super(messageKey);
    this.name = "DomainError";
    this.code = code;
    this.context = context;
  }
}
