import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT } from "../../errors/error-codes";
import { translate } from "../../i18n/index";
import { VisioForbiddenError } from "./errors";
import { signLivekitToken } from "./livekit-token";
import { sfuGetRequestSchema } from "./schema";
import type { CallParticipant, LivekitSettings, MatrixProfile, SfuDeps, SfuGetRequest } from "./types";

/** The answer of the token service (MSC4195): where the media go, and the token for it. */
export interface SfuGetResponse {
  url: string;
  jwt: string;
}

const localpart = (userId: string): string => userId.slice(1, userId.indexOf(":"));

/**
 * `POST /sfu/get`: the MatrixRTC token service of the calls of Twake Chat (D30).
 * The user is the one the OpenID token stands for, and must be a member of the
 * room. Meet mints the token when it is there, so that its functions know the
 * participant; otherwise ToM signs it itself (degraded mode, D-d).
 */
export async function sfuGetController(
  body: unknown,
  deps: SfuDeps,
  livekit: LivekitSettings,
  logger: Logger,
): Promise<SfuGetResponse> {
  const request = parseRequest(body);
  const userId = await deps.openId.resolve(request.openid_token);
  if (!(await deps.admin.isMember(userId, request.room))) {
    throw new VisioForbiddenError("visio.not_a_member");
  }
  const profile = await deps.admin.profile(userId);
  const participant: CallParticipant = {
    // The identity every MatrixRTC client derives for this device: never anything else
    identity: `${userId}:${request.device_id}`,
    name: profile.displayName ?? localpart(userId),
    role: deps.service && (await deps.admin.isModerator(userId, request.room)) ? "administrator" : "member",
    attributes: {
      matrix_user_id: userId,
      matrix_device_id: request.device_id,
    },
  };

  const jwt = (await mintWithMeet(request, participant, profile, deps, logger)) ?? degraded(request, participant, deps, livekit);

  return {
    url: livekit.url ?? "",
    jwt,
  };
}

function parseRequest(body: unknown): SfuGetRequest {
  const parsed = sfuGetRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new DomainError(INVALID_INPUT, "visio.invalid_request", {
      detail: parsed.error.issues.map((issue) => issue.path.join(".")).join(", "),
    });
  }

  return parsed.data;
}

/** The token of Meet, or null when Meet is not there or fails: the call goes on without its functions. */
async function mintWithMeet(
  request: SfuGetRequest,
  participant: CallParticipant,
  profile: MatrixProfile,
  deps: SfuDeps,
  logger: Logger,
): Promise<string | null> {
  if (!deps.service) {
    return null;
  }
  try {
    return (await deps.service.mintCallToken(request.room, participant, profile)).token;
  } catch (err) {
    logger.warn(
      translate("log.visio.degraded", {
        reason: err instanceof Error ? err.message : String(err),
      }),
    );

    return null;
  }
}

/** ToM signs the token itself, for the Meet room of the Matrix room when there is one (R20). */
function degraded(request: SfuGetRequest, participant: CallParticipant, deps: SfuDeps, livekit: LivekitSettings): string {
  return signLivekitToken({
    apiKey: livekit.api_key ?? "",
    apiSecret: livekit.api_secret ?? "",
    room: deps.service?.mappedRoom(request.room) ?? request.room,
    identity: participant.identity,
    name: participant.name,
    ttlSeconds: livekit.token_ttl_seconds,
    attributes: participant.attributes,
  });
}
