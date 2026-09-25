import type { Response as ExpressResponse, NextFunction, RequestHandler } from "express";
import { Lru } from "toad-cache";
import type { Logger } from "winston";
import type { z } from "zod";

import { DomainError } from "../../errors/domain-error";
import { BAD_GATEWAY, UNAUTHORIZED } from "../../errors/error-codes";
import { HttpClient, readJson } from "../../net/http-client";
import { whoamiSchema } from "./schema";
import type { AuthenticatedRequest, TokenValidatorSettings } from "./types";

const TOKEN_RE = /^Bearer (\S+)$/;
const REJECTED_STATUSES = new Set([
  401,
  403,
]);

export class TokenValidator {
  #config: TokenValidatorSettings;
  #log: Logger;
  #tokens: Lru<string>;
  #http: HttpClient;

  constructor(config: TokenValidatorSettings, logger: Logger) {
    this.#config = config;
    this.#log = logger;
    this.#tokens = new Lru<string>(config.tokenCacheSize, config.tokenCacheTtlMs);
    this.#http = new HttpClient({
      baseUrl: config.serverUrl,
      timeoutMs: config.timeoutMs,
    });
  }

  /** Validates the Matrix access token against the homeserver and sets `req.userId`. */
  middleware(): RequestHandler {
    return async (req: AuthenticatedRequest, _res: ExpressResponse, next: NextFunction): Promise<void> => {
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

  async #userId(token: string): Promise<string> {
    const cached = this.#tokens.get(token);
    if (cached) {
      return cached;
    }

    const userId = (await this.#get("/_matrix/client/v3/account/whoami", token, whoamiSchema))?.user_id;
    // Only local users may act through this server
    if (!userId?.endsWith(`:${this.#config.serverName}`)) {
      throw new DomainError(UNAUTHORIZED, "token rejected by the homeserver");
    }
    this.#tokens.set(token, userId);

    return userId;
  }

  async #get<Schema extends z.ZodType>(
    path: string,
    token: string,
    schema: Schema,
  ): Promise<z.infer<Schema> | undefined> {
    let response: Response;
    try {
      response = await this.#http.get(path, token);
    } catch (err) {
      throw this.#homeserverError(path, err instanceof Error ? err.message : "request failed");
    }
    if (REJECTED_STATUSES.has(response.status)) {
      return undefined;
    }
    if (!response.ok) {
      throw this.#homeserverError(path, `status ${response.status}`);
    }

    return readJson(response, schema);
  }

  #homeserverError(endpoint: string, reason: string): DomainError {
    this.#log.warn(`homeserver failure on ${endpoint}: ${reason}`);

    return new DomainError(BAD_GATEWAY, "homeserver failure", {
      endpoint,
    });
  }
}
