import type { Request } from "express";

export interface MatrixAuthSettings {
  serverUrl: string;
  serverName: string;
  timeoutMs: number;
  tokenCacheSize: number;
  tokenCacheTtlMs: number;
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  accessToken?: string;
}
