// Message text as safe HTML for a public page. No dependency: every function escapes first (or
// rebuilds every tag from a whitelist), so nothing a user wrote reaches the page as markup.
import { escapeHtml } from "./pages";

const REL = 'rel="noopener noreferrer nofollow"';
const SAFE_HREF = /^(?:https?:\/\/|mailto:)[^\s"'<>`]+$/i;

const anchor = (href: string, label: string): string =>
  SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}" ${REL}>${label}</a>` : label;

/** Inline Markdown of one raw (unescaped) text: code, links, bold, italic, strike. */
function inline(raw: string): string {
  const stash: string[] = [];
  const keep = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
  const text = raw
    .replace(/\u0000/g, "")
    .replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => keep(anchor(href, inline(label))))
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, (url) => keep(anchor(url, escapeHtml(url))));

  return escapeHtml(text)
    .replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)__(?=\S)(.+?)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/~~(?=\S)(.+?)~~/g, "<del>$1</del>")
    .replace(/\*(?=[^\s*])(.+?)\*/g, "<em>$1</em>")
    .replace(/(^|\W)_(?=[^\s_])(.+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => stash[Number(i)] ?? "");
}

/** Markdown (headings, lists, quotes, code blocks, paragraphs and the inline marks) to safe HTML. */
export function markdownToHtml(source: string): string {
  const out: string[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list = null as { tag: "ul" | "ol"; items: string[] } | null;
  const flush = (): void => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }
    if (list) {
      out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
    }
    para = [];
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    let m: RegExpMatchArray | null;
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").startsWith("```"); i++) {
        code.push(lines[i] ?? "");
      }
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
      flush();
      out.push(`<h${m[1]?.length}>${inline(m[2] ?? "")}</h${m[1]?.length}>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      out.push(`<blockquote>${inline(m[1] ?? "")}</blockquote>`);
    } else if ((m = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/))) {
      const tag = m[1] ? "ul" : "ol";
      if (list?.tag !== tag) {
        flush();
        list = { tag, items: [] };
      }
      list.items.push(m[2] ?? "");
    } else if (line.trim() === "") {
      flush();
    } else {
      if (list) {
        flush();
      }
      para.push(line);
    }
  }
  flush();

  return out.join("");
}

const TAGS = new Set(["b", "strong", "i", "em", "code", "pre", "a", "ul", "ol", "li", "p", "br", "blockquote", "del", "h1", "h2", "h3", "h4", "h5", "h6"]);
const VOID = new Set(["br"]);
/** Tags whose content is dropped with them. */
const DROPPED = new Set(["script", "style", "iframe", "object", "template", "noscript", "textarea", "title"]);
const decode = (s: string): string =>
  s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" })[e] ?? "");

/**
 * The `formatted_body` (org.matrix.custom.html) of a message, rebuilt from the Matrix whitelist: each
 * allowed tag is rewritten without attributes (an `a` keeps an http(s)/mailto `href` and gets `rel`),
 * any other tag is dropped, its text kept escaped; `script`-like content goes with its tag.
 */
export function sanitizeFormatted(html: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let skip = 0;
  for (const part of html.replace(/\u0000/g, "").split(/(<[^>]*>)/)) {
    const tag = part.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/);
    if (!tag) {
      if (!skip) {
        out.push(escapeHtml(decode(part)));
      }
      continue;
    }
    const name = (tag[2] ?? "").toLowerCase();
    if (DROPPED.has(name)) {
      skip = Math.max(0, skip + (tag[1] ? -1 : tag[3]?.endsWith("/") ? 0 : 1));
    } else if (!skip && TAGS.has(name)) {
      if (tag[1]) {
        const at = open.lastIndexOf(name);
        if (at >= 0) {
          out.push(...open.splice(at).reverse().map((n) => `</${n}>`));
        }
      } else if (VOID.has(name)) {
        out.push(`<${name}>`);
      } else if (name === "a") {
        const href = decode((tag[3] ?? "").match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) ?? "");
        if (SAFE_HREF.test(href)) {
          open.push("a");
          out.push(`<a href="${escapeHtml(href)}" ${REL}>`);
        }
      } else {
        open.push(name);
        out.push(`<${name}>`);
      }
    }
  }
  out.push(...open.reverse().map((n) => `</${n}>`));

  return out.join("");
}
