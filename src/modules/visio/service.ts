import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { VisioRoomUnavailableError, VisioUpstreamError } from "./errors";
import { meetLivekitTokenSchema, meetRoomSchema, visioRoomResponseSchema, visioTokenResponseSchema } from "./schema";
import type { CallParticipant, MatrixProfile, VisioRoom, VisioSettings } from "./types";

const TOKEN_PATH = "/external-api/v1.0/application/token/";
const ROOMS_PATH = "/external-api/v1.0/rooms/";

/** The token Meet minted for a participant of the call of a Matrix room. */
export interface CallToken {
  /** The LiveKit room: the id of the Meet room. */
  room: string;
  token: string;
}

export class VisioService {
  #config: VisioSettings;
  #http: HttpClient;
  #log: Logger;
  /**
   * The Meet room of each Matrix room, as a promise so that two people joining at
   * once get the same room. ponytail: kept in memory, lost at a restart (the room
   * is then made again, Meet keeps the old one); a table when ToM runs twice.
   */
  #rooms = new Map<string, Promise<string>>();
  /** The rooms already made, readable at once (the degraded mode signs for them, R20). */
  #settled = new Map<string, string>();

  constructor(config: VisioSettings, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: config.base_url ?? "",
      timeoutMs: config.timeout_ms,
    });
    this.#log = logger;
  }

  async createRoom(email: string): Promise<VisioRoom> {
    const accessToken = await this.#applicationToken(email);

    const accessLevel = this.#config.room_access_level;
    const roomResponse = await this.#post(
      ROOMS_PATH,
      accessLevel
        ? {
            access_level: accessLevel,
          }
        : {},
      accessToken,
    );

    return this.#parse(ROOMS_PATH, roomResponse, visioRoomResponseSchema);
  }

  /** The Meet room already made for a Matrix room, when there is one. */
  mappedRoom(matrixRoomId: string): string | undefined {
    return this.#settled.get(matrixRoomId);
  }

  /**
   * A LiveKit token for a participant of the call of a Matrix room, minted by Meet
   * so that its functions (recording, transcription…) know the participant (D30).
   */
  async mintCallToken(matrixRoomId: string, participant: CallParticipant, profile: MatrixProfile): Promise<CallToken> {
    // The room first, whoever asks: a participant without an email is signed by
    // ToM for it (degraded mode), in the same LiveKit room as the others
    const meetRoomId = await this.#ensureRoom(matrixRoomId);
    if (!profile.email) {
      throw new VisioRoomUnavailableError("visio.email_unresolvable");
    }
    const accessToken = await this.#applicationToken(profile.email);
    const path = `${ROOMS_PATH}${encodeURIComponent(meetRoomId)}/livekit-token/`;
    const response = await this.#post(
      path,
      {
        identity: participant.identity,
        username: participant.name,
        role: participant.role,
        ...(profile.sub && {
          sub: profile.sub,
        }),
      },
      accessToken,
    );
    if (response.status === 404) {
      // The room is gone on the Meet side: make another one next time
      this.#rooms.delete(matrixRoomId);
      this.#settled.delete(matrixRoomId);
    }

    return this.#parse(path, response, meetLivekitTokenSchema);
  }

  #ensureRoom(matrixRoomId: string): Promise<string> {
    let room = this.#rooms.get(matrixRoomId);
    if (!room) {
      room = this.#createCallRoom().then(
        (id) => {
          this.#settled.set(matrixRoomId, id);
          return id;
        },
        (err: unknown) => {
          this.#rooms.delete(matrixRoomId);
          throw err;
        },
      );
      this.#rooms.set(matrixRoomId, room);
    }

    return room;
  }

  /** The room of a Matrix room belongs to the service account: no human enters through Meet's UI. */
  async #createCallRoom(): Promise<string> {
    const owner = this.#config.service_account_email;
    if (!owner) {
      throw new VisioRoomUnavailableError("visio.no_service_account");
    }
    const accessToken = await this.#applicationToken(owner);
    const response = await this.#post(
      ROOMS_PATH,
      {
        access_level: this.#config.room_access_level ?? "restricted",
        configuration: this.#config.room_configuration,
      },
      accessToken,
    );
    const room = await this.#parse(ROOMS_PATH, response, meetRoomSchema);

    return room.id;
  }

  async #applicationToken(email: string): Promise<string> {
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

    return access_token;
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
