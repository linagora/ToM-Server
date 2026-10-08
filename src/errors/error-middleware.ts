import type { NextFunction, Request, Response } from "express";

import { resolveMessage } from "../i18n/index";
import type { I18nConfig } from "../i18n/types";
import type { TomRequest } from "../types";
import { DomainError } from "./domain-error";
import type { ErrorCode } from "./error-codes";
import { INTERNAL } from "./error-codes";

const STATUS_MAP: Record<ErrorCode, number> = {
  M_INVALID_PARAM: 400,
  M_UNAUTHORIZED: 401,
  M_FORBIDDEN: 403,
  M_NOT_FOUND: 404,
  M_TERMS_NOT_SIGNED: 403,
  M_INVALID_PEPPER: 400,
  M_UNKNOWN: 500,
  M_SERVICE_UNAVAILABLE: 503,
  M_BAD_GATEWAY: 502,
  M_UNPROCESSABLE: 422,
  M_BOT_RECOVERY_NEEDED: 422,
  M_BOT_NOT_FOUND: 404,
};

export function errorMiddleware(i18nConfig: I18nConfig) {
  // Express error callback contract: void return is framework-mandated
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof DomainError) {
      const status = STATUS_MAP[err.code] ?? 500;
      // First Accept-Language entry, without its quality value ("fr;q=0.9" -> "fr")
      const locale = req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() || i18nConfig.locale;

      res.status(status).json({
        errcode: err.code,
        error: resolveMessage(locale, err.message, err.context),
      });
      return;
    }

    // Infrastructure failure — log full stack, return opaque 500
    const message = err instanceof Error ? err.message : String(err);
    (req as TomRequest).log.error("unhandled error", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });

    res.status(500).json({
      errcode: INTERNAL,
      error: resolveMessage(i18nConfig.locale, INTERNAL),
    });
  };
}
