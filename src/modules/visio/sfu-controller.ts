import type { Logger } from "winston";

import { DomainError } from "../../errors/domain-error";
import { INVALID_INPUT } from "../../errors/error-codes";
import { translate } from "../../i18n/index";
import { VisioForbiddenError } from "./errors";
import { sfuGetRequestSchema } from "./schema";
import type { CallParticipant, SfuDeps, SfuGetRequest } from "./types";

/** The answer of the token service (MSC4195): where the media go, and the token for it. */
export interface SfuGetResponse {
  url: string;
  jwt: string;
}

/** The longest identity Meet takes. */
const MAX_IDENTITY_LENGTH = 255;

const localpart = (userId: string): string => userId.slice(1, userId.indexOf(":"));

/**
 * `POST /sfu/get`: the MatrixRTC token service of the calls of Twake Chat (D30).
 * The user is the one the OpenID token stands for, and must be a member of the
 * room. Meet mints the token, so that its functions know the participant; when
 * it does not answer or refuses, the call has no token (no degraded mode).
 */
export async function sfuGetController(body: unknown, deps: SfuDeps, logger: Logger): Promise<SfuGetResponse> {
  const request = parseRequest(body);
  const userId = await deps.openId.resolve(request.openid_token);
  if (!(await deps.admin.isMember(userId, request.room))) {
    throw new VisioForbiddenError("visio.not_a_member");
  }
  // The identity every MatrixRTC client derives for this device: never anything else
  const identity = `${userId}:${request.device_id}`;
  if (identity.length > MAX_IDENTITY_LENGTH) {
    throw new DomainError(INVALID_INPUT, "visio.invalid_request", {
      detail: "device_id",
    });
  }
  const profile = await deps.admin.profile(userId);
  const participant: CallParticipant = {
    identity,
    name: profile.displayName ?? localpart(userId),
    role: (await isModerator(deps, userId, request.room, logger)) ? "administrator" : "member",
    attributes: {
      matrix_user_id: userId,
      matrix_device_id: request.device_id,
    },
  };

  const { url, token } = await deps.service.mintCallToken(request.room, participant, profile);

  return {
    url,
    jwt: token,
  };
}

/** The role is a refinement: when the power levels cannot be read, the call goes on with a member. */
async function isModerator(deps: SfuDeps, userId: string, roomId: string, logger: Logger): Promise<boolean> {
  try {
    return await deps.admin.isModerator(userId, roomId);
  } catch {
    logger.warn(translate("log.visio.moderator_unknown"));

    return false;
  }
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
