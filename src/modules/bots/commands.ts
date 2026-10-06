import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Logger } from "winston";

import { translate } from "../../i18n/index";
import { HttpClient, readJson } from "../../net/http-client";
import { joinedRoomsSchema } from "./schema";
import type { BotsSettings } from "./types";

/** MSC4332: the state event a bot writes in a room to announce its commands. */
export const COMMANDS_EVENT_TYPE = "org.matrix.msc4332.commands";

interface BotProfile {
  userId: string;
  token: string;
}

/** The credentials of every profile under `dir`, from its `.env`. */
export const readProfiles = (dir: string): BotProfile[] => {
  if (!existsSync(dir)) {
    return [];
  }
  const profiles: BotProfile[] = [];
  for (const name of readdirSync(dir)) {
    const env = join(dir, name, ".env");
    if (!existsSync(env)) {
      continue;
    }
    const values = new Map(
      readFileSync(env, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
    const userId = values.get("MATRIX_USER_ID");
    const token = values.get("MATRIX_ACCESS_TOKEN");
    if (userId && token) {
      profiles.push({
        userId,
        token,
      });
    }
  }
  return profiles;
};

/**
 * Hermes announces nothing (no MSC4332): ToM does it for every bot it
 * provisioned, in every room the bot is in, once per room. A room that
 * refuses the state (power levels) is tried again at the next round.
 */
export class BotCommandsPublisher {
  #config: BotsSettings;
  #http: HttpClient;
  #log: Logger;
  #done = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BotsSettings, serverUrl: string, logger: Logger) {
    this.#config = config;
    this.#http = new HttpClient({
      baseUrl: serverUrl,
      timeoutMs: config.timeout_ms,
    });
    this.#log = logger;
  }

  start(): void {
    const round = (): void => {
      this.publishAll().catch((err: unknown) => {
        this.#log.warn(translate("log.bots.commands_failed"), {
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    };
    round();
    this.#timer = setInterval(round, this.#config.publish_interval_ms);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async publishAll(): Promise<void> {
    for (const profile of readProfiles(this.#config.hermes_profiles_dir ?? "")) {
      const response = await this.#http.get("/_matrix/client/v3/joined_rooms", profile.token);
      const rooms = response.ok ? await readJson(response, joinedRoomsSchema) : undefined;
      for (const roomId of rooms?.joined_rooms ?? []) {
        await this.#publish(profile, roomId);
      }
    }
  }

  async #publish(profile: BotProfile, roomId: string): Promise<void> {
    const key = `${roomId}|${profile.userId}`;
    if (this.#done.has(key)) {
      return;
    }
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${COMMANDS_EVENT_TYPE}/${encodeURIComponent(profile.userId)}`;
    const current = await this.#http.get(path, profile.token);
    if (current.ok) {
      this.#done.add(key);
      return;
    }
    const written = await this.#http.put(
      path,
      {
        commands: this.#config.commands,
      },
      profile.token,
    );
    if (written.ok) {
      this.#done.add(key);
    } else {
      this.#log.warn(translate("log.bots.commands_refused"), {
        bot: profile.userId,
        room: roomId,
        status: written.status,
      });
    }
  }
}
