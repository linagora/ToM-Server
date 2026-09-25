import type { RequestHandler } from "express";
import type { z } from "zod";

import type { AuthenticatedRequest } from "../../middleware/auth/types";
import type { visioRoomResponseSchema, visioSettingsSchema } from "./schema";

export type VisioSettings = z.infer<typeof visioSettingsSchema>;
export type VisioRoom = z.infer<typeof visioRoomResponseSchema>;

export interface VisioDeps {
  authenticate: RequestHandler;
  resolveEmail(req: AuthenticatedRequest): Promise<string | null>;
}
