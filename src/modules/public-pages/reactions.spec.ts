import { describe, expect, it } from "bun:test";

import { createLogger } from "winston";

import Database from "../legacy/db/database";
import { DbReactionStore, REACTIONS_INDEXES, REACTIONS_SCHEMA } from "./reactions";

describe("DbReactionStore", () => {
  it("toggles and counts per event and key", async () => {
    const db = new Database<"public_reactions">(
      {
        database_engine: "sqlite",
        database_host: ":memory:",
      } as never,
      createLogger({
        silent: true,
      }) as never,
      REACTIONS_SCHEMA,
      REACTIONS_INDEXES,
    );
    await db.ready;
    const store = new DbReactionStore(db);

    expect(await store.toggle("!r", "$1", "a", "v1")).toBe(true);
    expect(await store.toggle("!r", "$1", "a", "v2")).toBe(true);
    expect(await store.toggle("!r", "$2", "b", "v1")).toBe(true);
    expect(
      await store.counts("!r", [
        "$1",
        "$2",
        "$3",
      ]),
    ).toEqual({
      $1: {
        a: 2,
      },
      $2: {
        b: 1,
      },
    });
    expect(
      await store.mine(
        "!r",
        [
          "$1",
          "$2",
        ],
        "v1",
      ),
    ).toEqual({
      $1: [
        "a",
      ],
      $2: [
        "b",
      ],
    });
    expect(await store.toggle("!r", "$1", "a", "v1")).toBe(false);
    expect(
      await store.counts("!r", [
        "$1",
      ]),
    ).toEqual({
      $1: {
        a: 1,
      },
    });
    expect(
      await store.counts("!other", [
        "$1",
      ]),
    ).toEqual({});
  });
});
