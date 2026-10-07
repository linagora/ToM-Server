import type { RequestHandler } from "express";
import type { z } from "zod";

import type { botsSettingsSchema, myBotResponseSchema } from "./schema";

export type BotsSettings = z.infer<typeof botsSettingsSchema>;
export type HarnessSettings = NonNullable<BotsSettings["harness"]>;
export type MyBot = z.infer<typeof myBotResponseSchema>;

export interface BotsDeps {
  authenticate: RequestHandler;
}

/** What the routes ask of a backend, Hermes or the agent harness. */
export interface BotsProvisioner {
  /** The bot of the owner, provisioned at the first call: idempotent. */
  provision(ownerId: string, ownerToken: string, timezone?: string): Promise<MyBot>;
  /** The direct room of the owner with the bot. */
  setHome(ownerId: string, roomId: string): void | Promise<void>;
  /** Asks for the identity of the bot back, after the backend lost it: `bots/me` answers it once done. */
  recover(ownerId: string): void | Promise<void>;
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
