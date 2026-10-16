import { describe, expect, it } from "bun:test";

import { markdownToHtml, sanitizeFormatted } from "./markdown";

describe("markdownToHtml", () => {
  it("renders bold, italic, code and a list", () => {
    expect(markdownToHtml("**gras** et _it_ et `x<y`\n\n- un\n- deux")).toBe(
      "<p><strong>gras</strong> et <em>it</em> et <code>x&lt;y</code></p><ul><li>un</li><li>deux</li></ul>",
    );
  });

  it("renders links with a safe rel, bare URLs included", () => {
    const html = markdownToHtml("[Twake](https://twake.app/a_b_c) https://example.org/x.");
    expect(html).toContain('<a href="https://twake.app/a_b_c" rel="noopener noreferrer nofollow">Twake</a>');
    expect(html).toContain(
      '<a href="https://example.org/x" rel="noopener noreferrer nofollow">https://example.org/x</a>.',
    );
  });

  it("neutralizes scripts, handlers and javascript: links", () => {
    const html = markdownToHtml(
      '<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y]("onmouseover="a)',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sanitizeFormatted", () => {
  it("keeps whitelisted tags and strips their attributes", () => {
    expect(
      sanitizeFormatted(
        '<p style="x" onclick="a()"><b>gras</b> <a href="https://t.app/?a=1&amp;b=2" onclick="x">lien</a></p>',
      ),
    ).toBe('<p><b>gras</b> <a href="https://t.app/?a=1&amp;b=2" rel="noopener noreferrer nofollow">lien</a></p>');
  });

  it("drops scripts, unknown tags and unsafe hrefs", () => {
    const html = sanitizeFormatted(
      '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><a href=" javascript:alert(1)">y</a><div onclick="a">z</div><ul><li>un</ul>',
    );
    expect(html).toBe("xyz<ul><li>un</li></ul>");
  });
});
