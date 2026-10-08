import { createHash } from "node:crypto";

import type Database from "../legacy/db/database";
import type { ReactionStore } from "./types";

export const REACTIONS_TABLE = "public_reactions";
export const REACTIONS_SCHEMA: Record<typeof REACTIONS_TABLE, string> = {
  public_reactions:
    "id varchar(64) PRIMARY KEY, room_id varchar(255) NOT NULL, event_id varchar(255) NOT NULL, reaction_key varchar(32) NOT NULL, visitor_id varchar(64) NOT NULL, created_at bigint NOT NULL, UNIQUE (room_id, event_id, reaction_key, visitor_id)",
};
export const REACTIONS_INDEXES = {
  public_reactions: [
    "room_id",
  ],
};

const idOf = (...parts: string[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** `public_reactions` in the database of ToM: one row per (room, event, key, visitor). */
export class DbReactionStore implements ReactionStore {
  #db: Database<typeof REACTIONS_TABLE>;
  #now: () => number;

  constructor(db: Database<typeof REACTIONS_TABLE>, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  async toggle(roomId: string, eventId: string, key: string, visitorId: string): Promise<boolean> {
    const id = idOf(roomId, eventId, key, visitorId);
    const rows = await this.#db.get(
      REACTIONS_TABLE,
      [
        "id",
      ],
      {
        id,
      },
    );
    if (rows.length > 0) {
      await this.#db.deleteEqual(REACTIONS_TABLE, "id", id);

      return false;
    }
    await this.#db.insert(REACTIONS_TABLE, {
      id,
      room_id: roomId,
      event_id: eventId,
      reaction_key: key,
      visitor_id: visitorId,
      created_at: this.#now(),
    });

    return true;
  }

  async counts(roomId: string, eventIds: string[]): Promise<Record<string, Record<string, number>>> {
    const out: Record<string, Record<string, number>> = {};
    for (const row of await this.#rows(roomId, eventIds, {})) {
      const event = String(row.event_id);
      const key = String(row.reaction_key);
      out[event] = {
        ...out[event],
        [key]: (out[event]?.[key] ?? 0) + 1,
      };
    }

    return out;
  }

  async mine(roomId: string, eventIds: string[], visitorId: string): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const row of await this.#rows(roomId, eventIds, {
      visitor_id: visitorId,
    })) {
      const event = String(row.event_id);
      out[event] = [
        ...(out[event] ?? []),
        String(row.reaction_key),
      ];
    }

    return out;
  }

  #rows(roomId: string, eventIds: string[], extra: Record<string, string>) {
    if (eventIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.#db.get(
      REACTIONS_TABLE,
      [
        "event_id",
        "reaction_key",
      ],
      {
        room_id: roomId,
        event_id: eventIds,
        ...extra,
      },
    );
  }
}
