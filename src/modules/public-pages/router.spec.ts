import { beforeAll, describe, expect, it } from "bun:test";

import express from "express";
import request from "supertest";
import { createLogger } from "winston";

import { loadMessages } from "../../i18n/index";
import type { PublicPagesDeps } from "./router";
import { createPublicPagesRouter } from "./router";
import type { MessageEvent, PagesSource, ReactionStore, StateEvent } from "./types";

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

let reactionId = 0;
const reaction = (sender: string, key: string): MessageEvent => ({
  type: "m.reaction",
  event_id: `$r${++reactionId}`,
  sender,
  origin_server_ts: 1_760_000_000_001,
  content: {
    "m.relates_to": {
      rel_type: "m.annotation",
      event_id: "$1",
      key,
    },
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
  reports: string[][];
} => {
  const reports: string[][] = [];
  const reads: string[] = [];
  const downloads: string[] = [];

  return {
    reads,
    reports,
    downloads,
    resolveAlias: (alias) => Promise.resolve(aliases[alias] ?? null),
    readState: (roomId) => Promise.resolve(rooms[roomId] ?? null),
    readMessages: (roomId) => {
      reads.push(roomId);

      return Promise.resolve([
        message("Hello"),
        reaction("@ed:hs", "\u{1F44D}"),
        reaction("@bo:hs", "\u{1F44D}"),
        reaction("@bo:hs", "\u{1F680}"),
      ]);
    },
    report: (roomId, eventId, reason) => {
      reports.push([
        roomId,
        eventId,
        reason,
      ]);

      return Promise.resolve();
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

const memoryStore = (): ReactionStore => {
  const rows = new Set<string>();
  const parse = (row: string): string[] => JSON.parse(row);

  return {
    toggle: (room, event, key, visitor) => {
      const row = JSON.stringify([
        room,
        event,
        key,
        visitor,
      ]);
      const added = !rows.has(row);
      if (added) {
        rows.add(row);
      } else {
        rows.delete(row);
      }

      return Promise.resolve(added);
    },
    counts: (room, events) => {
      const out: Record<string, Record<string, number>> = {};
      for (const [r, event = "", key = ""] of [
        ...rows,
      ].map(parse)) {
        if (r === room && events.includes(event)) {
          out[event] = {
            ...out[event],
            [key]: (out[event]?.[key] ?? 0) + 1,
          };
        }
      }

      return Promise.resolve(out);
    },
    mine: (room, events, visitor) => {
      const out: Record<string, string[]> = {};
      for (const [r, event = "", key = "", v] of [
        ...rows,
      ].map(parse)) {
        if (r === room && v === visitor && events.includes(event)) {
          out[event] = [
            ...(out[event] ?? []),
            key,
          ];
        }
      }

      return Promise.resolve(out);
    },
  };
};

const makeApp = (source: PagesSource, deps: Partial<PublicPagesDeps> = {}) =>
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
        reactions: memoryStore(),
        ...deps,
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

  const react = (app: ReturnType<typeof makeApp>, cookie = "", key = "\u{1F44D}", event = "$1") =>
    request(app).post("/b/figaro/react").set("Cookie", cookie).type("form").send({
      event_id: event,
      key,
    });
  const form = (app: ReturnType<typeof makeApp>, path: string, body: Record<string, string>) =>
    request(app).post(path).type("form").send(body);

  it("sets the CSP form-action to self and shows members' reactions", async () => {
    const res = await request(makeApp(fakeSource())).get("/b/figaro");

    expect(res.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(res.text).toContain('aria-label="React with \u{1F44D}, 2"');
    expect(res.text).toContain('<span class="other">\u{1F680} 1</span>');
    expect(res.text).toContain('action="/b/figaro/report"');
  });

  it("toggles a visitor reaction, merges it with the members', then removes it", async () => {
    const app = makeApp(fakeSource());
    const added = await react(app);

    expect(added.status).toBe(303);
    expect(added.headers.location).toBe("/b/figaro#post-%241");
    const cookie = String(added.headers["set-cookie"]?.[0]);
    expect(cookie).toMatch(
      /^tom_visitor=[a-f0-9]{32}; Max-Age=31536000; Path=\/b\/; Expires=.*HttpOnly; Secure; SameSite=Lax/,
    );
    const mine = cookie.split(";")[0] ?? "";
    expect((await request(app).get("/b/figaro").set("Cookie", mine)).text).toContain(
      'aria-pressed="true" aria-label="React with \u{1F44D}, 3"',
    );
    expect((await request(app).get("/b/figaro")).text).toContain(
      'aria-pressed="false" aria-label="React with \u{1F44D}, 3"',
    );
    expect((await react(app, mine)).status).toBe(303);
    expect((await request(app).get("/b/figaro").set("Cookie", mine)).text).toContain(
      'aria-pressed="false" aria-label="React with \u{1F44D}, 2"',
    );
  });

  it("refuses a reaction on a private room, an unknown event and an unknown key", async () => {
    const app = makeApp(fakeSource());

    expect(
      (
        await form(app, "/b/private/react", {
          event_id: "$1",
          key: "\u{1F44D}",
        })
      ).status,
    ).toBe(404);
    expect((await react(app, "", "\u{1F44D}", "$nope")).status).toBe(404);
    expect((await react(app, "", "\u{1F680}")).status).toBe(400);
  });

  it("limits the POSTs per IP", async () => {
    const app = makeApp(fakeSource());
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await react(app)).status;
    }

    expect(last).toBe(429);
  });

  it("answers the visitor counts as JSON, from any origin, for a public room only", async () => {
    const app = makeApp(fakeSource());
    await react(app);
    const res = await request(app).get("/_twake/v1/public-pages/reactions?room_id=!page:hs&event_id=$1&event_id=$2");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body).toEqual({
      reactions: {
        $1: {
          "\u{1F44D}": 1,
        },
        $2: {},
      },
    });
    expect((await request(app).get("/_twake/v1/public-pages/reactions?room_id=!private:hs&event_id=$1")).status).toBe(
      404,
    );
  });

  it("forwards a report with its reason and comment, never the IP or the cookie", async () => {
    const source = fakeSource();
    const app = makeApp(source);
    const res = await request(app)
      .post("/b/figaro/report")
      .set("Cookie", "tom_visitor=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      .type("form")
      .send({
        event_id: "$1",
        reason: "Spam",
        comment: "ads",
      });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/b/figaro?reported=1#post-%241");
    expect(source.reports).toEqual([
      [
        "!page:hs",
        "$1",
        "Public page visitor: Spam: ads",
      ],
    ]);
    expect(JSON.stringify(source.reports)).not.toMatch(/127\.0\.0\.1|::1|aaaaaaaa/);
    expect((await request(app).get("/b/figaro?reported=1")).text).toContain("Thank you, the report was sent.");
    expect(
      (
        await form(app, "/b/figaro/report", {
          event_id: "$1",
          reason: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await form(app, "/b/private/report", {
          event_id: "$1",
          reason: "Spam",
        })
      ).status,
    ).toBe(404);
  });

  it("limits reports to 5 per 10 minutes", async () => {
    const app = makeApp(fakeSource());
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await form(app, "/b/figaro/report", {
            event_id: "$1",
            reason: "Spam",
          })
        ).status,
      ).toBe(303);
    }

    expect(
      (
        await form(app, "/b/figaro/report", {
          event_id: "$1",
          reason: "Spam",
        })
      ).status,
    ).toBe(429);
  });
});
