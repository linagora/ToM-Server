import type { Logger } from "winston";
import type { z } from "zod";

import { VisioRoomUnavailableError, VisioUpstreamError } from "./errors";
import { visioRoomResponseSchema, visioTokenResponseSchema } from "./schema";
import type { VisioRoom, VisioSettings } from "./types";

const TOKEN_PATH = "/external-api/v1.0/application/token/";
const ROOMS_PATH = "/external-api/v1.0/rooms/";

export class VisioService {
  #config: VisioSettings;
  #baseUrl: string;
  #log: Logger;

  constructor(config: VisioSettings, logger: Logger) {
    this.#config = config;
    this.#baseUrl = config.base_url?.replace(/\/+$/, "") ?? "";
    this.#log = logger;
  }

  async createRoom(email: string): Promise<VisioRoom> {
    const tokenResponse = await this.#post(TOKEN_PATH, {
      client_id: this.#config.client_id,
      client_secret: this.#config.client_secret,
      grant_type: "client_credentials",
      scope: email,
    });

    if (tokenResponse.status === 404) {
      const msg = "visio token endpoint answered 404: external API disabled or user unknown to the service";
      this.#log.warn(msg);

      throw new VisioRoomUnavailableError(msg);
    }

    const { access_token } = await this.#parse(TOKEN_PATH, tokenResponse, visioTokenResponseSchema);

    const accessLevel = this.#config.room_access_level;
    const roomResponse = await this.#post(
      ROOMS_PATH,
      accessLevel
        ? {
            access_level: accessLevel,
          }
        : {},
      access_token,
    );

    return this.#parse(ROOMS_PATH, roomResponse, visioRoomResponseSchema);
  }

  async #post(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#config.timeout_ms),
      });
    } catch (err) {
      throw this.#upstreamError(path, err instanceof Error ? `${err.name}: ${err.message}` : "request failed");
    }
  }

  async #parse<Schema extends z.ZodType>(path: string, response: Response, schema: Schema): Promise<z.infer<Schema>> {
    if (!response.ok) {
      throw this.#upstreamError(path, `status ${response.status}`);
    }

    const payload: unknown = await response.json().catch(() => undefined);
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw this.#upstreamError(path, "unexpected body");
    }

    return result.data;
  }

  #upstreamError(endpoint: string, reason: string): VisioUpstreamError {
    const msg = `visio upstream failure on ${endpoint}: ${reason}`;
    this.#log.warn(msg);

    return new VisioUpstreamError(msg, {
      endpoint,
    });
  }
}
