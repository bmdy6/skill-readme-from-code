import { marked } from "marked";
import GithubSlugger from "github-slugger";
const tokens = (md) => marked.lexer(md.replace(/<!--[\s\S]*?-->/g, ""));
export function shellBlocks(md) {
  const out = [];
  marked.walkTokens(tokens(md), (t) => {
    if (
      t.type === "code" &&
      (!t.lang || /^(sh|bash|shell|console|zsh)$/.test(t.lang))
    )
      out.push({ index: out.length, code: t.text, language: t.lang || "sh" });
  });
  return out;
}
export function headings(md) {
  const slugger = new GithubSlugger();
  return tokens(md)
    .filter((t) => t.type === "heading")
    .map((t) => ({
      depth: t.depth,
      text: t.text,
      slug: slugger.slug(t.text.replace(/<[^>]*>|[\*_`]/g, "")),
    }));
}
export function images(md) {
  const out = [];
  marked.walkTokens(tokens(md), (t) => {
    if (t.type === "image")
      out.push({ src: t.href, alt: t.text, width: null, source: false });
    if (t.type !== "html") return;
    for (const m of t.text.matchAll(/<(img|source)\b([^>]+)>/gi)) {
      const get = (k) =>
        m[2].match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
      out.push({
        src: get("src") || get("srcset"),
        alt: get("alt"),
        width: get("width"),
        source: m[1].toLowerCase() === "source",
      });
    }
  });
  return out;
}
// Parse rendered Markdown (including reference images), not examples in fences.
// Badge endpoints and explicitly named local badge assets are status signals.
export function badges(md) {
  const out = [];
  const add = (src, alt, href = null) => {
    if (
      src &&
      /(?:shields\.io\/|badgen\.net\/|(?:travis-ci\.(?:org|com)|circleci\.com|codecov\.io|coveralls\.io)\/|\/badge(?:[/.?_-]|$)|(?:^|[/_-])badge[s]?[._-])/i.test(
        src,
      )
    )
      out.push({ src, alt: alt || "", href });
  };
  const visit = (list, href = null) => {
    const parentHref = href;
    for (const t of list) {
      if (t.type === "image") add(t.href, t.text, href);
      else if (t.type === "html") {
        let anchor = href;
        const attr = (tag, name) =>
          tag
            .match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]
            ?.replace(/&amp;/g, "&");
        for (const m of t.text.matchAll(
          /<(?:a|img)\b(?:"[^"]*"|'[^']*'|[^'">])*>|<\/a\s*>/gi,
        )) {
          if (/^<a\b/i.test(m[0])) anchor = attr(m[0], "href") || null;
          else if (/^<\/a/i.test(m[0])) anchor = parentHref;
          else add(attr(m[0], "src"), attr(m[0], "alt"), anchor);
        }
        // Inline HTML links and images can be separate lexer tokens.
        href = anchor;
      } else if (t.type !== "code" && t.type !== "codespan") {
        if (t.tokens) visit(t.tokens, t.type === "link" ? t.href : href);
        if (t.items) for (const item of t.items) visit(item.tokens, href);
      }
    }
  };
  visit(tokens(md));
  return out;
}
export function links(md) {
  const out = images(md)
    .map((i) => i.src)
    .filter(Boolean);
  marked.walkTokens(tokens(md), (t) => {
    if (t.type === "link") out.push(t.href);
    if (t.type === "html")
      for (const m of t.text.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi))
        out.push(m[1]);
  });
  return [...new Set(out)];
}
export const prose = (md) =>
  md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^```[^\n]*\n[\s\S]*?^```|^~~~[^\n]*\n[\s\S]*?^~~~/gm, "")
    .replace(/^.*\|.*$/gm, "")
    .replace(/<picture>[\s\S]*?<\/picture>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+/g, "");

// Keep list items independent; a list marker is structure, never a sentence.
export function proseParagraphs(md) {
  const out = [];
  const visit = (list) => {
    for (const t of list) {
      if (t.type === "list") for (const item of t.items) visit(item.tokens);
      else if (t.type === "blockquote") visit(t.tokens);
      else if (t.type === "paragraph" || t.type === "text")
        out.push(prose(t.text));
    }
  };
  visit(tokens(md));
  return out;
}

// Use the same visible lead forms as firstScreen; captions are not taglines.
export function leadText(md) {
  let afterImage = false;
  for (const t of tokens(md)) {
    if (t.type === "space") continue;
    if ((t.type === "heading" && t.depth === 1) ||
        (t.type === "html" && /<h1\b[^>]*>[\s\S]*<\/h1>/i.test(t.text))) {
      const banner = images(t.type === "html"
        ? t.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)[1]
        : t.raw)[0];
      if (banner?.alt?.trim()) return banner.alt.trim();
      afterImage = false;
      continue;
    }
    // An image block's next prose block is its caption. A title between a
    // logo and the tagline resets this adjacency; blank lines do not.
    const imageBlock = images(t.raw || t.text || "").some(
      (i) => !/badge|shields\.io|badgen/i.test(i.src || ""),
    );
    if (imageBlock) {
      afterImage = true;
      continue;
    }
    if (afterImage) {
      afterImage = false;
      if (["paragraph", "html"].includes(t.type)) continue;
    }
    if (t.type === "html") {
      const lead = t.text.match(/<(h[23]|blockquote|p)\b[^>]*>([\s\S]*?)<\/\1>/i);
      if (lead) return lead[2].replace(/<[^>]*>/g, "").trim();
    }
    if (t.type === "heading" && [2, 3].includes(t.depth)) return t.text;
    if (t.type === "blockquote") return prose(t.text).trim();
    if (t.type === "paragraph" && !/^!?\[/.test(t.text) && !/^</.test(t.text))
      return t.text;
  }
}
