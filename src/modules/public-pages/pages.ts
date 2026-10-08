// Reading a room as a public page and rendering it. Pure: no network, no clock.
import type { ListedRoom, MessageEvent, Page, Post, StateEvent } from "./types";

/** How its page looks (set by Twake Chat on a Broadcast). */
const PAGE_STYLE_TYPE = "app.twake.chat.page_style";
/** The posts shown on a page, newest first. */
const POST_LIMIT = 30;
const DESCRIPTION_LIMIT = 300;
const DEFAULT_ACCENT = "#2b6cb0";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
/** A room id; from room version 12 it names no server (MSC4291). */
const ROOM_ID = /^![A-Za-z0-9._=\-/+]+(?::[A-Za-z0-9.:-]+)?$/;
const MXC = /^mxc:\/\/([A-Za-z0-9.:-]+)\/([A-Za-z0-9_-]+)$/;

export type Ref =
  | {
      alias: string;
    }
  | {
      roomId: string;
    };

/** A URL reference: a slug (alias `#slug:server`) or a room id; null for anything else. */
export function parseRef(ref: string, serverName: string): Ref | null {
  if (SLUG.test(ref)) {
    return {
      alias: `#${ref}:${serverName}`,
    };
  }

  return ROOM_ID.test(ref)
    ? {
        roomId: ref,
      }
    : null;
}

export function parseMxc(url: unknown): {
  server: string;
  id: string;
} | null {
  const match = typeof url === "string" ? MXC.exec(url) : null;

  return match?.[1] && match[2]
    ? {
        server: match[1],
        id: match[2],
      }
    : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * THE gate: a room has a public page when anyone may read its history or join it, it is not
 * end-to-end encrypted and it is not a space. Every read of Synapse as admin goes through it.
 */
export function isPublic(state: StateEvent[]): boolean {
  const of = (type: string): Record<string, unknown> =>
    state.find((event) => event.type === type && event.state_key === "")?.content ?? {};

  return (
    (of("m.room.history_visibility").history_visibility === "world_readable" ||
      of("m.room.join_rules").join_rule === "public") &&
    !state.some((event) => event.type === "m.room.encryption") &&
    of("m.room.create").type !== "m.space"
  );
}

/** The latest text of each edited post (m.replace), by the id of the post. */
function editsOf(messages: MessageEvent[]): Map<string, Record<string, unknown>> {
  const edits = new Map<string, Record<string, unknown>>();
  for (const event of [
    ...messages,
  ].reverse()) {
    const relation = event.content["m.relates_to"];
    const content = event.content["m.new_content"];
    if (isRecord(relation) && relation.rel_type === "m.replace" && isRecord(content)) {
      edits.set(text(relation.event_id), content);
    }
  }

  return edits;
}

function postsOf(messages: MessageEvent[], names: Map<string, string>): Post[] {
  const edits = editsOf(messages);

  return messages
    .filter((event) => {
      const relation = event.content["m.relates_to"];
      const type = isRecord(relation) ? relation.rel_type : undefined;

      // A redacted post has no body; edits and thread replies are no posts
      return (
        event.type === "m.room.message" &&
        typeof event.content.body === "string" &&
        type !== "m.replace" &&
        type !== "m.thread"
      );
    })
    .slice(0, POST_LIMIT)
    .map((event) => {
      const content = edits.get(event.event_id) ?? event.content;
      const isImage = content.msgtype === "m.image" && parseMxc(content.url) !== null;

      return {
        id: event.event_id,
        author: names.get(event.sender) || event.sender,
        at: event.origin_server_ts,
        text: isImage ? "" : text(content.body),
        image: isImage
          ? {
              url: text(content.url),
              alt: text(content.body),
            }
          : null,
      };
    });
}

/** What a page shows; null when the room fails the gate. */
export function readPage(ref: string, state: StateEvent[], messages: MessageEvent[]): Page | null {
  if (!isPublic(state)) {
    return null;
  }
  const of = (type: string): Record<string, unknown> =>
    state.find((event) => event.type === type && event.state_key === "")?.content ?? {};
  const members = state.filter((event) => event.type === "m.room.member");
  const names = new Map(
    members.map((event) => [
      event.state_key,
      text(event.content.displayname),
    ]),
  );
  const style = of(PAGE_STYLE_TYPE);
  const color = text(style.accent_color);
  const avatar = text(of("m.room.avatar").url);

  return {
    ref,
    name: text(of("m.room.name").name) || ref,
    topic: text(of("m.room.topic").topic),
    avatarUrl: parseMxc(avatar) ? avatar : null,
    coverUrl: parseMxc(style.cover_url) ? text(style.cover_url) : null,
    accentColor: /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT,
    followerCount: members.filter((event) => event.content.membership === "join").length,
    posts: postsOf(messages, names),
  };
}

/** Every media a page shows: the only ones its media route serves. */
export function mediaOf(page: Page): Set<string> {
  const urls = [
    page.avatarUrl,
    page.coverUrl,
    ...page.posts.map((post) => post.image?.url),
  ];

  return new Set(urls.filter((url): url is string => Boolean(url)));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped text, its lines kept and its web links made links. */
function renderText(value: string): string {
  return escapeHtml(value)
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => `<a href="${url}" rel="nofollow noopener">${url}</a>`)
    .replace(/\n/g, "<br>");
}

/** The path of a page, on this service. */
export const pagePath = (ref: string): string => `/b/${encodeURIComponent(ref)}`;

/** The path of a media of the page, on this service. */
export function mediaPath(ref: string, mxc: string): string {
  const media = parseMxc(mxc);

  return `${pagePath(ref)}/media/${encodeURIComponent(media?.server ?? "")}/${media?.id ?? ""}`;
}

/** JSON inside a script element: no « < » may end it. */
const jsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

export interface RenderOptions {
  publicUrl: string;
  chatUrl?: string;
  lang?: string;
}

function structuredData(page: Page, publicUrl: string, imageUrl: string | null): unknown {
  const description = page.topic.slice(0, DESCRIPTION_LIMIT);

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: publicUrl + pagePath(page.ref),
    name: page.name,
    mainEntity: {
      "@type": "Organization",
      name: page.name,
      ...(description
        ? {
            description,
          }
        : {}),
      ...(imageUrl
        ? {
            image: imageUrl,
          }
        : {}),
    },
    hasPart: page.posts.map((post) => ({
      "@type": "SocialMediaPosting",
      datePublished: new Date(post.at).toISOString(),
      author: {
        "@type": "Person",
        name: post.author,
      },
      ...(post.text
        ? {
            text: post.text,
          }
        : {}),
      ...(post.image
        ? {
            image: publicUrl + mediaPath(page.ref, post.image.url),
          }
        : {}),
    })),
  };
}

function metaTags(page: Page, url: string, imageUrl: string | null): string {
  const description = page.topic.slice(0, DESCRIPTION_LIMIT);

  return [
    [
      "description",
      description,
    ],
    [
      "og:type",
      "profile",
    ],
    [
      "og:title",
      page.name,
    ],
    [
      "og:description",
      description,
    ],
    [
      "og:url",
      url,
    ],
    ...(imageUrl
      ? [
          [
            "og:image",
            imageUrl,
          ],
        ]
      : []),
    [
      "twitter:card",
      imageUrl ? "summary_large_image" : "summary",
    ],
  ]
    .map(([name = "", content = ""]) =>
      name.startsWith("og:")
        ? `<meta property="${name}" content="${escapeHtml(content)}">`
        : `<meta name="${name}" content="${escapeHtml(content)}">`,
    )
    .join("\n    ");
}

function postHtml(page: Page, post: Post): string {
  const iso = new Date(post.at).toISOString();
  const image = post.image
    ? `<img src="${mediaPath(page.ref, post.image.url)}" alt="${escapeHtml(post.image.alt)}" loading="lazy">`
    : "";

  return `<li class="post">
          <p class="meta"><span>${escapeHtml(post.author)}</span> · <time datetime="${iso}">${iso.slice(0, 10)}</time></p>
          ${post.text ? `<p>${renderText(post.text)}</p>` : ""}
          ${image}
        </li>`;
}

const STYLE = `
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
      .cover { height: 180px; background: var(--accent); }
      .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
      main { max-width: 680px; margin: 0 auto; padding: 0 16px 48px; }
      header { display: flex; gap: 16px; align-items: flex-end; margin-top: -48px; }
      header img, .avatar { width: 96px; height: 96px; border-radius: 50%; border: 4px solid var(--bg); background: var(--accent); object-fit: cover; flex: none; }
      h1 { margin: 0 0 4px; font-size: 1.75rem; }
      .muted, .meta { color: var(--muted); }
      .meta { font-size: .875rem; margin: 0 0 8px; }
      ul { list-style: none; padding: 0; }
      .post { background: var(--card); border-radius: 12px; padding: 16px; margin: 16px 0; border-left: 4px solid var(--accent); }
      .post p { margin: 0 0 8px; overflow-wrap: anywhere; }
      .post img { max-width: 100%; border-radius: 8px; }
      a { color: var(--fg); text-decoration-color: var(--accent); }
      .follow { display: inline-block; margin-top: 16px; padding: 8px 16px; border-radius: 8px; background: var(--fg); color: var(--bg); text-decoration: none; }`;

/** The HTML of a page, for people and for search engines. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the HTML template
export function renderPage(page: Page, { publicUrl, chatUrl = "", lang = "en" }: RenderOptions): string {
  const url = publicUrl + pagePath(page.ref);
  const image = page.coverUrl ?? page.avatarUrl;
  const imageUrl = image ? publicUrl + mediaPath(page.ref, image) : null;
  const posts = page.posts.map((post) => postHtml(page, post)).join("\n        ");
  const followers = `${page.followerCount} ${page.followerCount === 1 ? "follower" : "followers"}`;

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(page.name)}</title>
    <link rel="canonical" href="${escapeHtml(url)}">
    ${metaTags(page, url, imageUrl)}
    <script type="application/ld+json">${jsonForScript(structuredData(page, publicUrl, imageUrl))}</script>
    <style>
      :root { --accent: ${page.accentColor}; --bg: #ffffff; --fg: #1b1b1f; --muted: #5d5e61; --card: #f4f4f6; }
      @media (prefers-color-scheme: dark) { :root { --bg: #121214; --fg: #ececf0; --muted: #b4b5b9; --card: #1e1e22; } }${STYLE}
    </style>
  </head>
  <body>
    <div class="cover">${page.coverUrl ? `<img src="${mediaPath(page.ref, page.coverUrl)}" alt="">` : ""}</div>
    <main>
      <header>
        ${page.avatarUrl ? `<img src="${mediaPath(page.ref, page.avatarUrl)}" alt="">` : '<span class="avatar" aria-hidden="true"></span>'}
        <div>
          <h1>${escapeHtml(page.name)}</h1>
          <p class="muted" data-testid="followers">${followers}</p>
        </div>
      </header>
      ${page.topic ? `<p>${renderText(page.topic)}</p>` : ""}
      ${chatUrl ? `<a class="follow" href="${escapeHtml(chatUrl)}">Follow in Twake Chat</a>` : ""}
      <h2>Posts</h2>
      ${page.posts.length > 0 ? `<ul>\n        ${posts}\n      </ul>` : '<p class="muted">Nothing posted yet.</p>'}
    </main>
  </body>
</html>
`;
}

/** The ref of a listed room in the sitemap: its local alias slug, else its room id. */
function sitemapRef(room: ListedRoom, serverName: string): string | null {
  const alias = room.canonical_alias;
  if (alias?.endsWith(`:${serverName}`)) {
    const slug = alias.slice(1, alias.indexOf(":"));
    if (SLUG.test(slug)) {
      return slug;
    }
  }

  return ROOM_ID.test(room.room_id) ? room.room_id : null;
}

/** The rooms that pass the gate, as the admin list of Synapse tells them. */
export function renderSitemap(
  rooms: ListedRoom[],
  {
    publicUrl,
    serverName,
  }: {
    publicUrl: string;
    serverName: string;
  },
): string {
  const urls = rooms
    .filter(
      (room) =>
        (room.history_visibility === "world_readable" || room.join_rules === "public") &&
        !room.encryption &&
        room.room_type !== "m.space",
    )
    .map((room) => sitemapRef(room, serverName))
    .filter((ref): ref is string => ref !== null)
    .map((ref) => `  <url><loc>${escapeHtml(publicUrl + pagePath(ref))}</loc></url>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

export const renderRobots = (publicUrl: string): string =>
  `User-agent: *\nAllow: /b/\nSitemap: ${publicUrl}/sitemap.xml\n`;
