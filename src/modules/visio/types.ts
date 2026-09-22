import type { Request, RequestHandler } from "express";
import type { z } from "zod";

import type { visioRoomResponseSchema, visioSettingsSchema } from "./schema";

export type VisioSettings = z.infer<typeof visioSettingsSchema>;
export type VisioRoom = z.infer<typeof visioRoomResponseSchema>;

export interface VisioRequest extends Request {
  userId?: string;
  accessToken?: string;
}

export interface VisioDeps {
  authenticate: RequestHandler;
  resolveEmail(req: VisioRequest): Promise<string | null>;
}
