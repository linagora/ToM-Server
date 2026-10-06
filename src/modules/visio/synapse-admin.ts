import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioUpstreamError } from "./errors";
import { adminUserSchema, loginResponseSchema, roomMembersSchema, roomStateSchema } from "./schema";
import type { MatrixProfile } from "./types";

const LOGIN_PATH = "/_matrix/client/v3/login";
const MODERATOR_POWER_LEVEL = 50;

export interface SynapseAdminSettings {
  serverUrl: string;
  timeoutMs: number;
  admin: {
    login: string;
    password: string;
    accessToken: string;
  };
}

/**
 * The admin API of Synapse, for what the token service must know of a user and a
 * room: membership, power level, name, email and OIDC identity. The admin token
 * comes from the configuration, or from a login with the admin credentials.
 */
export class SynapseAdmin {
  #config: SynapseAdminSettings;
  #http: HttpClient;
  #log: Logger;
  #token: string | null = null;

  constructor(config: SynapseAdminSettings, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: config.serverUrl,
      timeoutMs: config.timeoutMs,
    });
    this.#log = logger;
  }

  async isMember(userId: string, roomId: string): Promise<boolean> {
    const path = `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`;
    const response = await this.#get(path);
    if (response.status === 404) {
      return false;
    }
    const body = await this.#parse(path, response, roomMembersSchema);

    return body.members.includes(userId);
  }

  /** True when the user may moderate the room (power level of a moderator or more). */
  async isModerator(userId: string, roomId: string): Promise<boolean> {
    const path = `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/state`;
    const body = await this.#parse(path, await this.#get(path), roomStateSchema);
    const content = body.state.find((event) => event.type === "m.room.power_levels")?.content ?? {};
    const users = content.users as Record<string, unknown> | undefined;
    const level = users?.[userId] ?? content.users_default ?? 0;

    return typeof level === "number" && level >= MODERATOR_POWER_LEVEL;
  }

  async profile(userId: string): Promise<MatrixProfile> {
    const path = `/_synapse/admin/v2/users/${encodeURIComponent(userId)}`;
    const body = await this.#parse(path, await this.#get(path), adminUserSchema);
    const emails = body.threepids.filter((threepid) => threepid.medium === "email");

    return {
      displayName: body.displayname ?? null,
      email: emails.length === 1 ? (emails[0]?.address ?? null) : null,
      sub: body.external_ids[0]?.external_id ?? null,
    };
  }

  async #get(path: string): Promise<Response> {
    const token = await this.#adminToken();
    try {
      return await this.#http.get(path, token);
    } catch (err) {
      throw this.#upstreamError(path, err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
  }

  async #adminToken(): Promise<string> {
    if (this.#token) {
      return this.#token;
    }
    if (this.#config.admin.accessToken) {
      this.#token = this.#config.admin.accessToken;
      return this.#token;
    }
    let response: Response;
    try {
      response = await this.#http.post(LOGIN_PATH, {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: this.#config.admin.login,
        },
        password: this.#config.admin.password,
        initial_device_display_name: "ToM calls",
      });
    } catch (err) {
      throw this.#upstreamError(LOGIN_PATH, err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
    const login = await this.#parse(LOGIN_PATH, response, loginResponseSchema);
    this.#token = login.access_token;

    return this.#token;
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
      translate("log.visio.homeserver_failure", {
        endpoint,
        reason,
      }),
    );

    return new VisioUpstreamError("visio.homeserver_failure", {
      endpoint,
    });
  }
}
