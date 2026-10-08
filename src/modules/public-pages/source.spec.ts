import { describe, expect, it } from "bun:test";

import type { SynapseAdmin } from "../visio/synapse-admin";
import { makeSynapseSource } from "./source";

describe("makeSynapseSource", () => {
  it("reads every page of the admin room list", async () => {
    const paths: string[] = [];
    const admin = {
      readOrNull: (path: string) => {
        paths.push(path);
        const from = Number(new URL(path, "http://synapse").searchParams.get("from"));

        return Promise.resolve(
          from === 0
            ? {
                rooms: [
                  {
                    room_id: "!a:localhost",
                  },
                ],
                next_batch: 500,
              }
            : {
                rooms: [
                  {
                    room_id: "!b:localhost",
                  },
                ],
              },
        );
      },
    } as unknown as SynapseAdmin;

    const rooms = await makeSynapseSource(admin).listRooms();

    expect(rooms.map((room) => room.room_id)).toEqual([
      "!a:localhost",
      "!b:localhost",
    ]);
    expect(paths).toHaveLength(2);
  });
});
