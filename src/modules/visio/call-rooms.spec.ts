import { beforeEach, describe, expect, it } from "bun:test";

import { createLogger } from "winston";

import Database from "../legacy/db/database";
import { CALL_ROOMS_SCHEMA, DbCallRooms } from "./call-rooms";

const silentLogger = createLogger({
  silent: true,
});

const ROOM = "!room:localhost";

// The SQLite backend of the legacy Database: the primary key of the table is the real one.
// Both backends (pg, sqlite) reject `insert` on a primary key violation, which `add` relies on.
describe("DbCallRooms on SQLite", () => {
  let rooms: DbCallRooms;

  beforeEach(async () => {
    const db = new Database<"visio_call_rooms">(
      {
        database_engine: "sqlite",
        database_host: ":memory:",
      } as never,
      silentLogger as never,
      CALL_ROOMS_SCHEMA,
    );
    await db.ready;
    rooms = new DbCallRooms(db);
  });

  it("should find no Meet room for an unknown Matrix room", async () => {
    expect(await rooms.get(ROOM)).toBeUndefined();
  });

  it("should give back the Meet room it recorded", async () => {
    // Act
    const added = await rooms.add(ROOM, "meet-1");

    // Assert
    expect(added).toBe("meet-1");
    expect(await rooms.get(ROOM)).toBe("meet-1");
  });

  it("should converge two concurrent adds on one winner, both callers getting it", async () => {
    // Act
    const [a, b] = await Promise.all([
      rooms.add(ROOM, "meet-a"),
      rooms.add(ROOM, "meet-b"),
    ]);

    // Assert
    expect(a).toBe(b);
    expect(await rooms.get(ROOM)).toBe(a);
    expect([
      "meet-a",
      "meet-b",
    ]).toContain(a);
  });

  it("should forget only while the row holds the given Meet room", async () => {
    // Arrange
    await rooms.add(ROOM, "meet-1");

    // Act
    await rooms.forget(ROOM, "meet-other");
    const kept = await rooms.get(ROOM);
    await rooms.forget(ROOM, "meet-1");

    // Assert
    expect(kept).toBe("meet-1");
    expect(await rooms.get(ROOM)).toBeUndefined();
  });

  it("should record the new Meet room after a forget", async () => {
    // Arrange
    await rooms.add(ROOM, "meet-1");
    await rooms.forget(ROOM, "meet-1");

    // Act & Assert
    expect(await rooms.add(ROOM, "meet-2")).toBe("meet-2");
    expect(await rooms.get(ROOM)).toBe("meet-2");
  });
});
