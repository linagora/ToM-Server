import type { Request } from "express";

export interface MatrixAuthSettings {
  serverUrl: string;
  serverName: string;
  timeoutMs: number;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  accessToken?: string;
}
