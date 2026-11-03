import { describe, expect, it } from "bun:test";
import SQLite from "./sqlite";

const noop = (): void => {};
const logger = { error: noop, warn: noop, info: noop, debug: noop, silly: noop } as any;

describe("TwakeDB SQLite get with an empty filter value", () => {
  it.each([[""], [[]], [[""]], [null], [undefined]])("selects nothing for id = %p", async (id) => {
    const db = new SQLite<"matrixTokens">(
      { database_engine: "sqlite", database_host: ":memory:" } as any,
      logger,
      { matrixTokens: "id varchar(64) PRIMARY KEY, data text" },
      {},
      { matrixTokens: [{ id: "tok", data: '{"sub":"@alice:example.com"}' }] },
    );
    await db.ready;
    expect(await db.get("matrixTokens", ["data"], { id } as any)).toEqual([]);
  });
});
