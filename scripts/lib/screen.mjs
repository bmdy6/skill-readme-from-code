import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { marked } from "marked";
import GithubSlugger from "github-slugger";
import { read, write, escape } from "./io.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const remotePlaceholder =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20"><rect width="120" height="20" rx="3" fill="#e5e7eb"/><text x="60" y="14" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#4b5563">Remote image</text></svg>';

export function routeScreenRequest(route, { offline = false } = {}) {
  const request = route.request();
  if (!/^https?:/i.test(request.url())) return route.continue();
  if (request.method() !== "GET" || request.resourceType() !== "image")
    return route.abort();
  return offline
    ? route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: remotePlaceholder,
      })
    : route.continue();
}
export async function markdownHTML(md, { local = false } = {}) {
  if (!local)
    try {
      const token =
        process.env.GITHUB_TOKEN ||
        execFileSync("gh", ["auth", "token"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      const r = await fetch("https://api.github.com/markdown", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "readme-from-code",
        },
        body: JSON.stringify({ text: md, mode: "gfm" }),
      });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return { html: await r.text(), renderer: "github-api" };
    } catch (e) {
      return {
        ...(await markdownHTML(md, { local: true })),
        fallbackReason: e.message,
      };
    }
  const slugger = new GithubSlugger();
  const renderer = new marked.Renderer();
  renderer.heading = ({ depth, text }) =>
    `<h${depth} id="${escape(slugger.slug(text.replace(/<[^>]*>|[\*_`]/g, "")))}">${marked.parseInline(text)}</h${depth}>`;
  return {
    html: marked.parse(md, { renderer }),
    renderer: "local-marked",
    fallbackReason: local ? "Local rendering requested" : undefined,
  };
}
export async function firstScreen({
  repo,
  work,
  readme = "README.md",
  install,
  local = false,
  offline = false,
}) {
  const installCommand = typeof install === "string" ? install : install?.command;
  const download = install?.url
    ? {
        url: install.url,
        heading: typeof install.heading === "string"
          ? install.heading
          : install.heading?.[readme === "README.zh-CN.md" ? "zh-CN" : "en"],
      }
    : null;
  const md = await read(path.join(repo, readme));
  const rendered = await markdownHTML(md, { local: local || offline });
  const css = await read(path.join(root, "templates/github-markdown.css"));
  await fs.mkdir(work, { recursive: true });
  const htmlFile = path.join(work, "screen.html");
  await write(
    htmlFile,
    `<!doctype html><meta charset="utf-8"><base href="${escape(pathToFileURL(repo + path.sep).href)}"><style>${css}
 body{margin:0;background:#fff;padding-top:72px}.markdown-body{box-sizing:content-box;width:838px;margin:auto;padding:24px 32px;min-height:900px}img{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}body.dark{background:#0d1117}.dark .markdown-body{color:#e6edf3;background:#0d1117}.dark .markdown-body pre,.dark .markdown-body code{background:#161b22}.dark .markdown-body a{color:#79c0ff}.dark .markdown-body pre,.dark .markdown-body pre code,.dark .markdown-body pre span{color:#e6edf3}.dark .markdown-body code{color:inherit}
 @media(max-width:767px){.markdown-body{box-sizing:border-box;width:100%;padding:16px}}.sticky{height:72px;position:absolute;top:0;left:0;right:0;border-bottom:1px solid #8884;padding:24px;box-sizing:border-box;font:14px system-ui;color:#687078;background:inherit}</style><div class="sticky">README</div><article class="markdown-body">${rendered.html}</article>`,
  );
  const browser = await chromium.launch();
  const viewports = {};
  try {
    for (const [name, width, height, theme] of [
      ["desktop", 1280, 800, "light"],
      ["desktop-dark", 1280, 800, "dark"],
      ["mobile", 390, 844, "light"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        colorScheme: theme,
        serviceWorkers: "block",
      });
      await page.route("**/*", (route) =>
        routeScreenRequest(route, { offline }),
      );
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
      await page.evaluate(
        (t) => document.body.classList.toggle("dark", t === "dark"),
        theme,
      );
      await page.evaluate(() => document.fonts.ready);
      const measured = await page.evaluate(
        ({ installCommand, download, height }) => {
          const root = document.querySelector("article");
          const box = (e) => {
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
            };
          };
          const imgs = [...root.querySelectorAll("img")].filter(
            (i) =>
              !/badge|shields\.io|badgen/i.test(i.src) && i.naturalHeight > 40,
          );
          const heading = root.querySelector("h1");
          const banner = imgs.find(
            (i) =>
              !heading ||
              heading.compareDocumentPosition(i) &
                Node.DOCUMENT_POSITION_PRECEDING,
          );
          const title = banner || heading;
          const lead = [...root.querySelectorAll("p,h2,h3,blockquote")].find(
            (p) =>
              p.textContent.trim().length > 10 &&
              !p.querySelector("img") &&
              (!heading ||
                !!(
                  heading.compareDocumentPosition(p) &
                  Node.DOCUMENT_POSITION_FOLLOWING
                )),
          );
          const hero = imgs.find((i) => i !== banner && i.naturalWidth >= 400);
          let installBox = null, installText = null;
          if (download) {
            const heading = [...root.querySelectorAll("h2,h3,h4")].find(
              (h) => h.textContent.trim() === download.heading,
            );
            const section = [];
            for (let e = heading?.nextElementSibling;
              e && !(/^H[1-6]$/.test(e.tagName) && e.tagName <= heading.tagName);
              e = e.nextElementSibling
            ) section.push(e);
            const link = section.flatMap((e) => [...e.querySelectorAll("a")])
              .find((a) => a.getAttribute("href") === download.url);
            const visible = (e) =>
              e.getClientRects().length && getComputedStyle(e).visibility === "visible";
            if (
              link?.textContent.trim() &&
              visible(link) &&
              visible(heading) &&
              section.some(
                (e) =>
                  e.matches("p,ol,ul") &&
                  visible(e) &&
                  e.textContent.trim() &&
                  !e.contains(link),
              )
            ) {
              const rects = [heading, ...section.filter(visible)].map(box);
              installBox = {
                top: Math.min(...rects.map((r) => r.top)),
                bottom: Math.max(...rects.map((r) => r.bottom)),
                left: Math.min(...rects.map((r) => r.left)),
                right: Math.max(...rects.map((r) => r.right)),
              };
              installText = link.textContent.trim();
            }
          } else {
            const pre = [...root.querySelectorAll("pre")].find((p) =>
              installCommand
                ? p.textContent.trim() === installCommand.trim()
                : /\b(npx|npm|pip|uv|cargo|git clone|brew|curl|python3?)\b/.test(
                    p.textContent,
                  ),
            );
            installBox = box(pre);
            installText = pre?.textContent.trim() || null;
          }
          const items = {
            name: box(title),
            oneLiner: box(lead),
            hero: hero?.complete && hero.naturalWidth ? box(hero) : null,
            install: installBox,
          };
          const checks = Object.fromEntries(
            Object.entries(items).map(([k, r]) => [
              k,
              !!r &&
                r.top >= 72 &&
                r.bottom <= height &&
                r.left >= 0 &&
                r.right <= innerWidth,
            ]),
          );
          return {
            items,
            checks,
            install: installText,
            contentWidth:
              root.clientWidth -
              parseFloat(getComputedStyle(root).paddingLeft) -
              parseFloat(getComputedStyle(root).paddingRight),
            fold: height,
            images: [...root.querySelectorAll("img")].map((i) => ({
              src: i.currentSrc || i.src,
              width: i.getBoundingClientRect().width,
              loaded: i.complete && i.naturalWidth > 0,
              naturalWidth: i.naturalWidth,
            })),
          };
        },
        { installCommand, download, height },
      );
      const file = `first-screen-${name}.png`;
      await page.screenshot({ path: path.join(work, file) });
      viewports[name] = {
        width,
        height,
        ...measured,
        screenshot: file,
        pass: Object.values(measured.checks).every(Boolean),
      };
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const result = {
    renderer: rendered.renderer,
    fallbackReason: rendered.fallbackReason,
    remoteImages: offline ? "neutral-placeholder" : "get-only",
    readme,
    viewports,
  };
  await write(path.join(work, "first-screen.json"), result);
  return result;
}
