import { beforeAll, describe, expect, it } from "bun:test";

import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { loadMessages } from "../../i18n/index";
import { createPublicPagesRouter } from "./router";
import type { MessageEvent, PagesSource, StateEvent } from "./types";

const silentLogger = createLogger({
  silent: true,
});

const state = (history: string, extra: StateEvent[] = []): StateEvent[] => [
  {
    type: "m.room.create",
    state_key: "",
    content: {},
  },
  {
    type: "m.room.history_visibility",
    state_key: "",
    content: {
      history_visibility: history,
    },
  },
  {
    type: "m.room.name",
    state_key: "",
    content: {
      name: "Figaro",
    },
  },
  {
    type: "m.room.avatar",
    state_key: "",
    content: {
      url: "mxc://hs/avatar",
    },
  },
  ...extra,
];

const message = (body: string): MessageEvent => ({
  type: "m.room.message",
  event_id: "$1",
  sender: "@ed:hs",
  origin_server_ts: 1_760_000_000_000,
  content: {
    msgtype: "m.text",
    body,
  },
});

const rooms: Record<string, StateEvent[]> = {
  "!page:hs": state("world_readable"),
  "!private:hs": state("shared"),
  "!secret:hs": state("world_readable", [
    {
      type: "m.room.encryption",
      state_key: "",
      content: {},
    },
  ]),
};
const aliases: Record<string, string> = {
  "#figaro:hs": "!page:hs",
  "#private:hs": "!private:hs",
  "#secret:hs": "!secret:hs",
};

const fakeSource = (): PagesSource & {
  reads: string[];
  downloads: string[];
} => {
  const reads: string[] = [];
  const downloads: string[] = [];

  return {
    reads,
    downloads,
    resolveAlias: (alias) => Promise.resolve(aliases[alias] ?? null),
    readState: (roomId) => Promise.resolve(rooms[roomId] ?? null),
    readMessages: (roomId) => {
      reads.push(roomId);

      return Promise.resolve([
        message("Hello"),
      ]);
    },
    listRooms: () => Promise.resolve([]),
    download: (server, id) => {
      downloads.push(`${server}/${id}`);

      return Promise.resolve(
        new Response(
          new Uint8Array([
            1,
            2,
            3,
          ]),
          {
            headers: {
              "content-type": "image/png",
            },
          },
        ),
      );
    },
  };
};

const makeApp = (source: PagesSource) =>
  express().use(
    createPublicPagesRouter(
      {
        enabled: true,
        public_url: "https://pages.test/",
        chat_url: "",
        lang: "en",
      },
      {
        source,
        serverName: "hs",
      },
      silentLogger,
    ),
  );

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("public pages router", () => {
  beforeAll(() => {
    loadMessages("assets/i18n", silentLogger);
  });

  it("serves the page of a slug with its security headers", async () => {
    const res = await request(makeApp(fakeSource())).get("/b/figaro");

    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.text).toContain("Hello");
    expect(res.text).toContain('<link rel="canonical" href="https://pages.test/b/figaro">');
  });

  it("serves the page of a URL-encoded room id", async () => {
    const res = await request(makeApp(fakeSource())).get(`/b/${encodeURIComponent("!page:hs")}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://pages.test/b/!page%3Ahs"');
  });

  it("answers HEAD", async () => {
    expect((await request(makeApp(fakeSource())).head("/b/figaro")).status).toBe(200);
  });

  it("answers 404 for a room that is not world readable or is encrypted, and never reads its messages or media", async () => {
    const source = fakeSource();
    const app = makeApp(source);

    for (const ref of [
      "private",
      "secret",
      encodeURIComponent("!private:hs"),
      encodeURIComponent("!secret:hs"),
    ]) {
      expect((await request(app).get(`/b/${ref}`)).status).toBe(404);
      expect((await request(app).get(`/b/${ref}/media/hs/avatar`)).status).toBe(404);
    }
    expect(source.reads).toEqual([]);
    expect(source.downloads).toEqual([]);
  });

  it("answers 404 for an unknown room, a bad ref and a room id that does not exist", async () => {
    const app = makeApp(fakeSource());

    for (const ref of [
      "nobody",
      "Not_A_Slug",
      encodeURIComponent("!nowhere:hs"),
    ]) {
      expect((await request(app).get(`/b/${ref}`)).status).toBe(404);
    }
  });

  it("serves the media the page shows and no other", async () => {
    const source = fakeSource();
    const app = makeApp(source);
    const avatar = await request(app).get("/b/figaro/media/hs/avatar");

    expect(avatar.status).toBe(200);
    expect(avatar.headers["content-type"]).toBe("image/png");
    expect(avatar.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect((await request(app).get("/b/figaro/media/hs/private")).status).toBe(404);
    expect(source.downloads).toEqual([
      "hs/avatar",
    ]);
  });

  it("refuses a media that is not an image, audio or video", async () => {
    const source = fakeSource();
    source.download = () =>
      Promise.resolve(
        new Response("<script>", {
          headers: {
            "content-type": "text/html",
          },
        }),
      );

    expect((await request(makeApp(source)).get("/b/figaro/media/hs/avatar")).status).toBe(404);
  });

  it("answers 502 when the homeserver fails", async () => {
    const source = fakeSource();
    source.readState = () => Promise.reject(new Error("down"));

    expect((await request(makeApp(source)).get("/b/figaro")).status).toBe(502);
  });

  it("serves robots.txt and the sitemap", async () => {
    const source = fakeSource();
    source.listRooms = () =>
      Promise.resolve([
        {
          room_id: "!page:hs",
          canonical_alias: "#figaro:hs",
          history_visibility: "world_readable",
          encryption: null,
          room_type: null,
        },
      ]);
    const app = makeApp(source);

    expect((await request(app).get("/robots.txt")).text).toContain("Sitemap: https://pages.test/sitemap.xml");
    expect((await request(app).get("/sitemap.xml")).text).toContain("<loc>https://pages.test/b/figaro</loc>");
  });
});
