import type { RequestHandler } from "express";
import type { z } from "zod";

import type { AuthenticatedRequest } from "../../middleware/auth/types";
import type { OpenIdValidator } from "./openid";
import type {
  livekitSettingsSchema,
  sfuGetRequestSchema,
  visioRoomResponseSchema,
  visioSettingsSchema,
} from "./schema";
import type { VisioService } from "./service";
import type { SynapseAdmin } from "./synapse-admin";

export type VisioSettings = z.infer<typeof visioSettingsSchema>;
export type LivekitSettings = z.infer<typeof livekitSettingsSchema>;
export type VisioRoom = z.infer<typeof visioRoomResponseSchema>;
export type SfuGetRequest = z.infer<typeof sfuGetRequestSchema>;

export interface VisioDeps {
  authenticate: RequestHandler;
  resolveEmail(req: AuthenticatedRequest): Promise<string | null>;
}

/** What the MatrixRTC token service needs (D30 of Twake Chat). */
export interface SfuDeps {
  openId: OpenIdValidator;
  admin: SynapseAdmin;
  /** Meet behind the token service; undefined when `visio` is disabled (degraded mode only). */
  service: VisioService | undefined;
}

/** What LiveKit will know the participant by. */
export interface CallParticipant {
  /** `{mxid}:{deviceId}`: the identity MatrixRTC derives on every client (never anything else). */
  identity: string;
  name: string;
  /** `administrator` for the moderators of the room, `member` for the others. */
  role: "administrator" | "member";
  attributes: Record<string, string>;
}

/** What the admin API of Synapse knows of a user, for Meet. */
export interface MatrixProfile {
  displayName: string | null;
  /** The single email of the user, null when it has none or several. */
  email: string | null;
  /** The subject of the OIDC identity provider, when the user signed in through it. */
  sub: string | null;
}
