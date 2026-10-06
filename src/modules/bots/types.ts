import type { RequestHandler } from "express";
import type { z } from "zod";

import type { botsSettingsSchema, myBotResponseSchema } from "./schema";

export type BotsSettings = z.infer<typeof botsSettingsSchema>;
export type MyBot = z.infer<typeof myBotResponseSchema>;

export interface BotsDeps {
  authenticate: RequestHandler;
}

/** What the service needs from the homeserver: the public URL, the server name, the admin. */
export interface SynapseAccess {
  serverUrl: string;
  serverName: string;
  admin: {
    login: string;
    password: string;
    accessToken: string;
  };
}
