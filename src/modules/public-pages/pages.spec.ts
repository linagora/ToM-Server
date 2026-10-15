import { describe, expect, it } from "bun:test";

import { initialsOf, isPublic, mediaOf, parseRef, readPage, renderPage, renderSitemap } from "./pages";
import type { MessageEvent, StateEvent } from "./types";

const event = (type: string, content: Record<string, unknown>, state_key = ""): StateEvent => ({
  type,
  state_key,
  content,
});

interface StateOptions {
  history?: string;
  space?: boolean;
  encrypted?: boolean;
  type?: string;
  joinRule?: string;
  optIn?: unknown;
  noOptIn?: boolean;
}

const state = ({
  history = "world_readable",
  space = false,
  encrypted = false,
  type,
  joinRule = "invite",
  optIn = {
    enabled: true,
  },
  noOptIn = false,
}: StateOptions = {}): StateEvent[] => [
  event("m.room.join_rules", {
    join_rule: joinRule,
  }),
  event(
    "m.room.create",
    space
      ? {
          type: "m.space",
        }
      : type
        ? {
            type,
          }
        : {},
  ),
  event("m.room.history_visibility", {
    history_visibility: history,
  }),
  event("m.room.name", {
    name: "Le <Figaro>",
  }),
  event("m.room.avatar", {
    url: "mxc://hs/avatar",
  }),
  event(
    "m.room.member",
    {
      membership: "join",
      displayname: "Ed",
    },
    "@ed:hs",
  ),
  ...(noOptIn
    ? []
    : [
        event("app.twake.chat.public_page", optIn as Record<string, unknown>),
      ]),
  ...(encrypted
    ? [
        event("m.room.encryption", {
          algorithm: "m.megolm.v1.aes-sha2",
        }),
      ]
    : []),
];

const post = (id: string, body: string, extra: Record<string, unknown> = {}): MessageEvent => ({
  type: "m.room.message",
  event_id: id,
  sender: "@ed:hs",
  origin_server_ts: 1_760_000_000_000,
  content: {
    msgtype: "m.text",
    body,
    ...extra,
  },
});

describe("the gate", () => {
  it("serves a world-readable, unencrypted room that is not a space, of any type", () => {
    expect(readPage("figaro", state(), [])).not.toBeNull();
    expect(
      readPage(
        "figaro",
        state({
          type: "app.twake.chat.page",
        }),
        [],
      ),
    ).not.toBeNull();
  });

  it("refuses a room anyone may join but whose history is kept to members", () => {
    for (const history of [
      "shared",
      "joined",
      "invited",
    ]) {
      const room = state({
        history,
        joinRule: "public",
      });
      expect(isPublic(room)).toBe(false);
      expect(
        readPage("figaro", room, [
          post("$1", "members only"),
        ]),
      ).toBeNull();
    }
  });

  it("leaves out what was sent before the room became world readable", () => {
    const room = state().map((e) =>
      e.type === "m.room.history_visibility"
        ? {
            ...e,
            origin_server_ts: 2000,
          }
        : e,
    );
    const at = (id: string, ts: number): MessageEvent => ({
      ...post(id, id),
      origin_server_ts: ts,
    });

    const page = readPage("figaro", room, [
      at("$new", 3000),
      at("$edge", 2000),
      at("$old", 1999),
    ]);

    expect(page?.posts.map((p) => p.id)).toEqual([
      "$new",
      "$edge",
    ]);
  });

  it("refuses any other history, encryption and spaces", () => {
    expect(
      isPublic(
        state({
          history: "shared",
        }),
      ),
    ).toBe(false);
    expect(
      isPublic(
        state({
          history: "invited",
        }),
      ),
    ).toBe(false);
    expect(
      isPublic(
        state({
          encrypted: true,
        }),
      ),
    ).toBe(false);
    expect(
      isPublic(
        state({
          space: true,
        }),
      ),
    ).toBe(false);
    expect(isPublic([])).toBe(false);
    expect(
      readPage(
        "figaro",
        state({
          encrypted: true,
        }),
        [],
      ),
    ).toBeNull();
  });
});

describe("parseRef", () => {
  it("reads a slug as a local alias and a room id as itself, nothing else", () => {
    expect(parseRef("figaro", "hs")).toEqual({
      alias: "#figaro:hs",
    });
    expect(parseRef("!abc/DEF+1:hs", "hs")).toEqual({
      roomId: "!abc/DEF+1:hs",
    });
    expect(parseRef("Not_A_Slug", "hs")).toBeNull();
    expect(parseRef("#figaro:hs", "hs")).toBeNull();
    // Room version 12: the id names no server
    expect(parseRef("!mK5Lj_zNBwra-FY3", "hs")).toEqual({
      roomId: "!mK5Lj_zNBwra-FY3",
    });
    expect(parseRef("!a b:hs", "hs")).toBeNull();
    // Encoded twice: Express decoded once, « %3A » is left
    expect(parseRef("!abc%3Ahs", "hs")).toEqual({
      roomId: "!abc:hs",
    });
    expect(parseRef("!abc%E0", "hs")).toBeNull();
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("the posts", () => {
  it("applies edits and leaves out thread replies, redactions and the edits themselves", () => {
    const page = readPage("figaro", state(), [
      post("$edit", "* new", {
        "m.relates_to": {
          rel_type: "m.replace",
          event_id: "$1",
        },
        "m.new_content": {
          msgtype: "m.text",
          body: "Shooting has started",
        },
      }),
      post("$reply", "a comment", {
        "m.relates_to": {
          rel_type: "m.thread",
          event_id: "$1",
        },
      }),
      {
        ...post("$gone", ""),
        content: {},
      },
      post("$1", "Shooting starts"),
    ]);

    expect(
      page?.posts.map((each) => [
        each.id,
        each.text,
        each.author,
      ]),
    ).toEqual([
      [
        "$1",
        "Shooting has started",
        "Ed",
      ],
    ]);
  });

  it("shows 30 posts at most", () => {
    const messages = Array.from(
      {
        length: 40,
      },
      (_, index) => post(`$${index}`, "hello"),
    );

    expect(readPage("figaro", state(), messages)?.posts).toHaveLength(30);
  });

  it("lists as media only the avatar, the cover and the images of the posts", () => {
    const page = readPage("figaro", state(), [
      post("$1", "photo", {
        msgtype: "m.image",
        url: "mxc://hs/photo",
      }),
      post("$2", "evil", {
        msgtype: "m.image",
        url: "https://evil.test/x.png",
      }),
    ]);

    expect(
      page && [
        ...mediaOf(page),
      ],
    ).toEqual([
      "mxc://hs/avatar",
      "mxc://hs/photo",
    ]);
  });
});

describe("renderPage", () => {
  const html = (ref = "figaro"): string => {
    const page = readPage(ref, state(), [
      post("$1", "<script>alert(1)</script> https://example.org/a?b=1&c=2", {
        format: "org.matrix.custom.html",
        formatted_body: "<img src=x onerror=alert(1)>",
      }),
    ]);

    return renderPage(page as NonNullable<typeof page>, {
      publicUrl: "https://pages.test",
      chatUrl: "https://chat.test",
    });
  };

  it("escapes what people wrote, never carries their HTML and links web links", () => {
    const out = html();

    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("onerror");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<title>Le &lt;Figaro&gt;</title>");
    expect(out).toContain('href="https://example.org/a?b=1&amp;c=2"');
    expect(out).toContain('<a class="follow" href="https://chat.test">');
  });

  it("carries the canonical URL, the Open Graph image and a JSON-LD that cannot close its script", () => {
    const out = html();
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)?.[1] ?? "";

    expect(out).toContain('<link rel="canonical" href="https://pages.test/b/figaro">');
    expect(out).toContain('property="og:image" content="https://pages.test/b/figaro/media/hs/avatar"');
    expect(ld).not.toContain("<");
    expect(JSON.parse(ld)["@type"]).toBe("ProfilePage");
  });

  it("encodes a room id in its paths", () => {
    const out = html("!abc:hs");

    expect(out).toContain('href="https://pages.test/b/!abc%3Ahs"');
    expect(out).toContain("/b/!abc%3Ahs/media/hs/avatar");
  });
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: test suite
describe("the opt-in", () => {
  it("refuses a room without the event, with enabled false or not a boolean, or with malformed content", () => {
    expect(
      isPublic(
        state({
          noOptIn: true,
        }),
      ),
    ).toBe(false);
    expect(
      readPage(
        "figaro",
        state({
          noOptIn: true,
        }),
        [],
      ),
    ).toBeNull();
    for (const optIn of [
      {},
      {
        enabled: false,
      },
      {
        enabled: "true",
      },
      {
        enabled: 1,
      },
      "enabled",
      null,
    ]) {
      expect(
        isPublic(
          state({
            optIn,
          }),
        ),
      ).toBe(false);
      expect(
        readPage(
          "figaro",
          state({
            optIn,
          }),
          [],
        ),
      ).toBeNull();
    }
  });

  it("serves a room with enabled true", () => {
    expect(isPublic(state())).toBe(true);
    expect(readPage("figaro", state(), [])).not.toBeNull();
  });

  it("reads the event of the empty state key only", () => {
    const other = [
      ...state({
        noOptIn: true,
      }),
      event(
        "app.twake.chat.public_page",
        {
          enabled: true,
        },
        "x",
      ),
    ];

    expect(isPublic(other)).toBe(false);
  });
});

describe("renderSitemap", () => {
  const room = (extra: Record<string, unknown>): Parameters<typeof renderSitemap>[0][number] => ({
    room_id: "!r:hs",
    canonical_alias: null,
    history_visibility: "world_readable",
    encryption: null,
    room_type: null,
    ...extra,
  });

  it("lists the rooms that pass the gate, by alias slug or by encoded room id", () => {
    const xml = renderSitemap(
      [
        room({
          canonical_alias: "#figaro:hs",
        }),
        room({
          room_id: "!noalias:hs",
        }),
        room({
          room_id: "!remote:hs",
          canonical_alias: "#other:elsewhere",
        }),
        room({
          room_id: "!shared:hs",
          history_visibility: "shared",
        }),
        room({
          room_id: "!enc:hs",
          encryption: "m.megolm.v1.aes-sha2",
        }),
        room({
          room_id: "!open:hs",
          history_visibility: "shared",
        }),
        room({
          room_id: "!space:hs",
          room_type: "m.space",
        }),
      ],
      {
        publicUrl: "https://pages.test",
        serverName: "hs",
      },
    );

    expect(
      [
        ...xml.matchAll(/<loc>(.*?)<\/loc>/g),
      ].map((match) => match[1]),
    ).toEqual([
      "https://pages.test/b/figaro",
      "https://pages.test/b/!noalias%3Ahs",
      "https://pages.test/b/!remote%3Ahs",
    ]);
  });

  it("draws initials when there is no avatar, and translates the page", () => {
    expect(initialsOf("Public canal for Diana")).toBe("PD");
    expect(initialsOf("figaro")).toBe("F");
    const page = readPage(
      "figaro",
      state().filter((e) => e.type !== "m.room.avatar"),
      [],
    );
    const html = renderPage(page as NonNullable<typeof page>, {
      publicUrl: "https://p.test",
      lang: "fr",
      chatUrl: "https://c.test",
    });

    expect(html).toContain('role="img" aria-label="Le &lt;Figaro&gt;">LF</span>');
    expect(html).toContain("Publications");
    expect(html).toContain("Rien n'est encore publié.");
    expect(html).toContain("Suivre dans Twake Chat");
    expect(html).toContain("1 abonné");
  });
});
