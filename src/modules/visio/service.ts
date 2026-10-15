import type { Logger } from "winston";
import type { z } from "zod";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import type { CallRooms } from "./call-rooms";
import { VisioRoomUnavailableError, VisioUpstreamError } from "./errors";
import { meetLivekitTokenSchema, meetRoomSchema, visioRoomResponseSchema, visioTokenResponseSchema } from "./schema";
import type { CallParticipant, MatrixProfile, VisioRoom, VisioSettings } from "./types";

const TOKEN_PATH = "/external-api/v1.0/application/token/";
const ROOMS_PATH = "/external-api/v1.0/rooms/";

/** The token Meet minted for a participant of the call of a Matrix room. */
export interface CallToken {
  /** The LiveKit server, as Meet gives it. */
  url: string;
  /** The LiveKit room: the id of the Meet room. */
  room: string;
  token: string;
}

export class VisioService {
  #config: VisioSettings;
  #http: HttpClient;
  #log: Logger;
  #callRooms: CallRooms | undefined;
  /** The rooms being made by this process, so that two people joining at once make one. */
  #making = new Map<string, Promise<string>>();

  constructor(config: VisioSettings, logger: Logger, callRooms?: CallRooms) {
    this.#callRooms = callRooms;
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

  /**
   * A LiveKit token for a participant of the call of a Matrix room, minted by Meet
   * so that its functions (recording, transcription…) know the participant (D30).
   */
  async mintCallToken(matrixRoomId: string, participant: CallParticipant, profile: MatrixProfile): Promise<CallToken> {
    if (!profile.email) {
      throw new VisioRoomUnavailableError("visio.email_unresolvable");
    }
    const meetRoomId = await this.#ensureRoom(matrixRoomId);
    const accessToken = await this.#applicationToken(profile.email);
    const body = {
      identity: participant.identity,
      username: participant.name,
      role: participant.role,
      ...(profile.sub && {
        sub: profile.sub,
      }),
    };
    let [path, response] = await this.#postToken(meetRoomId, body, accessToken);
    // A 404 alone is not enough to drop a room (a Meet without the route answers
    // Django's HTML 404): a room Meet confirms gone is replaced, and so is one it
    // still has but refuses in JSON, made before Meet recorded the application of
    // its rooms. Once per request; anything else keeps the room and fails.
    if (response.status === 404 && (await this.#isStale(meetRoomId, isJson(response)))) {
      await this.#callRooms?.forget(matrixRoomId, meetRoomId);
      [path, response] = await this.#postToken(await this.#ensureRoom(matrixRoomId), body, accessToken);
    }

    return this.#parse(path, response, meetLivekitTokenSchema);
  }

  async #postToken(
    meetRoomId: string,
    body: Record<string, unknown>,
    accessToken: string,
  ): Promise<
    [
      string,
      Response,
    ]
  > {
    const path = `${ROOMS_PATH}${encodeURIComponent(meetRoomId)}/livekit-token/`;

    return [
      path,
      await this.#post(path, body, accessToken),
    ];
  }

  /**
   * Whether the room must be replaced, asked to Meet as its owner (the service account;
   * the joiner has no role on it): gone (a JSON 404 of the room itself), or still there
   * while the token route refused it in JSON (a room older than its application in Meet).
   * Refused (403, a missing `rooms:retrieve` scope), failing or unreachable: not confirmed.
   */
  async #isStale(meetRoomId: string, tokenRefusedInJson: boolean): Promise<boolean> {
    const owner = this.#config.service_account_email;
    if (!owner) {
      return false;
    }
    try {
      const accessToken = await this.#applicationToken(owner);
      const response = await this.#http.get(`${ROOMS_PATH}${encodeURIComponent(meetRoomId)}/`, accessToken);

      return (response.status === 404 && isJson(response)) || (response.ok && tokenRefusedInJson);
    } catch {
      return false;
    }
  }

  #ensureRoom(matrixRoomId: string): Promise<string> {
    let room = this.#making.get(matrixRoomId);
    if (!room) {
      room = this.#findOrMakeRoom(matrixRoomId).finally(() => this.#making.delete(matrixRoomId));
      this.#making.set(matrixRoomId, room);
    }

    return room;
  }

  /**
   * The Meet room is the one in the table: Meet names its rooms itself, so the only
   * stable link from a Matrix room is the row. Two replicas making one at once
   * converge on the first row; the other Meet room stays empty, harmless.
   */
  async #findOrMakeRoom(matrixRoomId: string): Promise<string> {
    if (!this.#callRooms) {
      throw new Error("VisioService has no store for the call rooms");
    }

    return (await this.#callRooms.get(matrixRoomId)) ?? this.#callRooms.add(matrixRoomId, await this.#createCallRoom());
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

/** Whether Meet answered from its API (JSON), not from Django's HTML pages. */
function isJson(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("application/json");
}
