import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioRoomUnavailableError, VisioUpstreamError } from "./errors";
import { visioRoomResponseSchema, visioTokenResponseSchema } from "./schema";
import type { VisioRoom, VisioSettings } from "./types";

const TOKEN_PATH = "/external-api/v1.0/application/token/";
const ROOMS_PATH = "/external-api/v1.0/rooms/";

export class VisioService {
  #config: VisioSettings;
  #http: HttpClient;
  #log: Logger;

  constructor(config: VisioSettings, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: config.base_url ?? "",
      timeoutMs: config.timeout_ms,
    });
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
      this.#log.warn(translate("log.visio.room_unavailable"));

      throw new VisioRoomUnavailableError("visio.room_unavailable");
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
      return await this.#http.post(path, body, token);
    } catch (err) {
      throw this.#upstreamError(path, err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
  }

  async #parse<Schema extends z.ZodType>(path: string, response: Response, schema: Schema): Promise<z.infer<Schema>> {
    if (!response.ok) {
      throw this.#upstreamError(
        path,
        translate("log.net.status", {
          status: response.status,
        }),
      );
    }

    const body = await readJson(response, schema);
    if (body === undefined) {
      throw this.#upstreamError(path, translate("log.net.unexpected_body"));
    }

    return body;
  }

  #upstreamError(endpoint: string, reason: string): VisioUpstreamError {
    this.#log.warn(
      translate("log.visio.upstream_failure", {
        endpoint,
        reason,
      }),
    );

    return new VisioUpstreamError("visio.upstream_failure", {
      endpoint,
      reason,
    });
  }
}
