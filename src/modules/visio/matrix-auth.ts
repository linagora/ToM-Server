import type { NextFunction, RequestHandler, Response } from "express";
import { Lru } from "toad-cache";
import type { Logger } from "winston";
import { z } from "zod";

import { DomainError } from "../../errors/domain-error";
import { UNAUTHORIZED } from "../../errors/error-codes";
import type { VisioRequest } from "./types";

const TOKEN_RE = /^Bearer (\S+)$/;
const TOKEN_CACHE_SIZE = 1000;
const TOKEN_CACHE_TTL_MS = 60_000;

const whoamiSchema = z.object({
  user_id: z.string().min(1),
});

const threepidsSchema = z.object({
  threepids: z.array(
    z.object({
      medium: z.string(),
      address: z.string(),
    }),
  ),
});

export interface MatrixAuthSettings {
  serverUrl: string;
  serverName: string;
  timeoutMs: number;
}

export class MatrixAuth {
  #config: MatrixAuthSettings;
  #log: Logger;
  #tokens = new Lru<string>(TOKEN_CACHE_SIZE, TOKEN_CACHE_TTL_MS);

  constructor(config: MatrixAuthSettings, logger: Logger) {
    this.#config = config;
    this.#log = logger;
  }

  /** Validates the Matrix access token against the homeserver and sets `req.userId`. */
  middleware(): RequestHandler {
    return async (req: VisioRequest, _res: Response, next: NextFunction): Promise<void> => {
      try {
        const token = TOKEN_RE.exec(req.headers.authorization ?? "")?.[1];
        if (!token) {
          throw new DomainError(UNAUTHORIZED, "missing bearer token");
        }
        req.userId = await this.#userId(token);
        req.accessToken = token;
        next();
      } catch (err) {
        next(err);
      }
    };
  }

  /** The user's email as known by the homeserver, or null. */
  async resolveEmail(token: string): Promise<string | null> {
    const body = await this.#get("/_matrix/client/v3/account/3pid", token);
    const result = threepidsSchema.safeParse(body);
    if (!result.success) {
      return null;
    }

    return result.data.threepids.find((threepid) => threepid.medium === "email")?.address ?? null;
  }

  async #userId(token: string): Promise<string> {
    const cached = this.#tokens.get(token);
    if (cached) {
      return cached;
    }

    const result = whoamiSchema.safeParse(await this.#get("/_matrix/client/v3/account/whoami", token));
    // Only local users may act through this server
    if (!result.success || !result.data.user_id.endsWith(`:${this.#config.serverName}`)) {
      throw new DomainError(UNAUTHORIZED, "token rejected by the homeserver");
    }
    this.#tokens.set(token, result.data.user_id);

    return result.data.user_id;
  }

  async #get(path: string, token: string): Promise<unknown> {
    let response: globalThis.Response;
    try {
      response = await fetch(`${this.#config.serverUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (err) {
      this.#log.warn(`homeserver unreachable on ${path}: ${err instanceof Error ? err.message : "request failed"}`);
      throw new DomainError(UNAUTHORIZED, "homeserver unreachable", {
        cause: err,
      });
    }
    if (!response.ok) {
      return undefined;
    }

    return response.json().catch(() => undefined);
  }
}
