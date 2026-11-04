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
