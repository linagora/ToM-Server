import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioUpstreamError } from "./errors";
import { adminUserSchema, joinedRoomsSchema, loginResponseSchema, roomStateSchema } from "./schema";
import type { MatrixProfile } from "./types";

const LOGIN_PATH = "/_matrix/client/v3/login";
const MODERATOR_POWER_LEVEL = 50;
/** From this room version, the creators hold the power of `m.room.create`, not a level in `m.room.power_levels`. */
const CREATORS_FROM_ROOM_VERSION = 12;

export interface SynapseAdminSettings {
  serverUrl: string;
  timeoutMs: number;
  /** `idp_id` of the OIDC provider whose subject Meet binds to its user; none, none sent. */
  oidcProvider?: string;
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
  #login: Promise<string> | null = null;

  constructor(config: SynapseAdminSettings, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: config.serverUrl,
      timeoutMs: config.timeoutMs,
    });
    this.#log = logger;
  }

  async isMember(userId: string, roomId: string): Promise<boolean> {
    // One small read of the user's rooms, not the member list of a room that may hold thousands
    const path = `/_synapse/admin/v1/users/${encodeURIComponent(userId)}/joined_rooms`;
    const response = await this.#get(path);
    if (response.status === 404) {
      return false;
    }
    const body = await this.#parse(path, response, joinedRoomsSchema);

    return body.joined_rooms.includes(roomId);
  }

  /** True when the user may moderate the room (power level of a moderator or more). */
  async isModerator(userId: string, roomId: string): Promise<boolean> {
    const path = `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/state`;
    const body = await this.#parse(path, await this.#get(path), roomStateSchema);
    const create = body.state.find((event) => event.type === "m.room.create");
    if (Number(create?.content.room_version) >= CREATORS_FROM_ROOM_VERSION) {
      const additional = Array.isArray(create?.content.additional_creators) ? create.content.additional_creators : [];
      if (create?.sender === userId || additional.includes(userId)) {
        return true;
      }
    }
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
      sub: this.#config.oidcProvider
        ? (body.external_ids.find((id) => id.auth_provider === this.#config.oidcProvider)?.external_id ?? null)
        : null,
    };
  }

  /** The body of an admin API GET validated against `schema`, or null when the answer is 404. */
  async readOrNull<Schema extends z.ZodType>(path: string, schema: Schema): Promise<z.infer<Schema> | null> {
    const response = await this.#get(path);
    if (response.status === 404) {
      return null;
    }

    return this.#parse(path, response, schema);
  }

  /** The raw answer of a GET with the admin token (media), whatever its status. */
  raw(path: string): Promise<Response> {
    return this.#get(path);
  }

  /** A POST with the admin token; throws when Synapse refuses. */
  post(path: string, body: Record<string, unknown>): Promise<void> {
    return this.#write(path, (token) => this.#http.post(path, body, token));
  }

  /** A PUT with the admin token; throws when Synapse refuses. */
  put(path: string, body: Record<string, unknown>): Promise<void> {
    return this.#write(path, (token) => this.#http.put(path, body, token));
  }

  async #write(path: string, send: (token: string) => Promise<Response>): Promise<void> {
    const response = await this.#authorized(path, send);
    if (!response.ok) {
      throw this.#upstreamError(
        path,
        translate("log.net.status", {
          status: response.status,
        }),
      );
    }
  }

  #get(path: string): Promise<Response> {
    return this.#authorized(path, (token) => this.#http.get(path, token));
  }

  /**
   * A call with the admin token. A token Synapse refuses (revoked, expired) is
   * dropped and replaced by a new login, once; a configured token cannot be
   * replaced, so its 401 is the answer.
   */
  async #authorized(path: string, send: (token: string) => Promise<Response>): Promise<Response> {
    const response = await this.#attempt(path, send);
    if (response.status !== 401 || this.#config.admin.accessToken) {
      return response;
    }
    await response.body?.cancel();
    this.#token = null;

    return this.#attempt(path, send);
  }

  async #attempt(path: string, send: (token: string) => Promise<Response>): Promise<Response> {
    const token = await this.#adminToken();
    try {
      return await send(token);
    } catch (err) {
      throw this.#upstreamError(path, err instanceof Error ? err.message : translate("log.net.request_failed"));
    }
  }

  #adminToken(): Promise<string> {
    if (this.#token) {
      return Promise.resolve(this.#token);
    }
    if (this.#config.admin.accessToken) {
      this.#token = this.#config.admin.accessToken;
      return Promise.resolve(this.#token);
    }
    // Calls that need a token meanwhile share the login in flight: one device, not one per call
    this.#login ??= this.#logIn().finally(() => {
      this.#login = null;
    });

    return this.#login;
  }

  async #logIn(): Promise<string> {
    let response: Response;
    try {
      response = await this.#http.post(LOGIN_PATH, {
        type: "m.login.password",
        identifier: {
          type: "m.id.user",
          user: this.#config.admin.login,
        },
        password: this.#config.admin.password,
        initial_device_display_name: "ToM",
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
