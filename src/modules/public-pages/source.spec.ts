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

  it("reports the room, naming the post, when Synapse hides the event from the admin", async () => {
    const posts: [
      string,
      Record<string, unknown>,
    ][] = [];
    const admin = {
      post: (path: string, body: Record<string, unknown>) => {
        posts.push([
          path,
          body,
        ]);

        return path.includes("/report/") ? Promise.reject(new Error("404")) : Promise.resolve();
      },
    } as unknown as SynapseAdmin;

    await makeSynapseSource(admin).report("!r:hs", "$e", "Public page visitor: Spam");

    expect(posts.map(([path]) => path)).toEqual([
      "/_matrix/client/v3/rooms/!r%3Ahs/report/%24e",
      "/_matrix/client/v3/rooms/!r%3Ahs/report",
    ]);
    expect(posts[1]?.[1]).toEqual({
      reason: "Public page visitor: Spam (event $e)",
    });
  });
});
