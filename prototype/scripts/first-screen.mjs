#!/usr/bin/env node
// Render a README the way GitHub does (GitHub Markdown API + github-markdown-css),
// screenshot the first screen on desktop and mobile, and check that the four
// storefront items are above the fold: name, one-liner, hero visual, install command.
// Usage:
//   node first-screen.mjs --readme README.md --repo owner/name --out DIR [--install REGEX]
//   node first-screen.mjs --github-url https://github.com/owner/name/tree/branch --out DIR
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const STICKY = 72; // GitHub's sticky README tab bar plus a little air
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const INSTALL = /\b(npx|npm (i|install)|pnpm|yarn add|pip install|uv |pipx|brew install|cargo install|go install|curl |docker run)\b/;

async function renderGfm(text, repo) {
  const token = process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  const res = await fetch("https://api.github.com/markdown", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "repo-storefront" },
    body: JSON.stringify({ text, mode: "gfm", context: repo }),
  });
  if (!res.ok) throw Error(`GitHub Markdown API ${res.status}: ${await res.text()}`);
  return res.text();
}

// Runs in the page. Positions are relative to the top of the README body.
function measure({ installSrc, offset }) {
  const install = new RegExp(installSrc);
  const root = document.querySelector("article.markdown-body, .markdown-body");
  const top = root.getBoundingClientRect().top + window.scrollY + offset;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY - top), bottom: Math.round(r.bottom + window.scrollY - top) };
  };
  // The name is either the first heading or a banner/logo image that comes before it (centered-header READMEs).
  const isBadge = (i) => /shields\.io|badge|badgen/.test(i.src) || i.naturalHeight <= 40;
  const heading = root.querySelector("h1, h2, h3");
  const imgs = [...root.querySelectorAll("img")].filter((i) => !isBadge(i));
  const banner = imgs.find((i) => i.alt && (!heading || (heading.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING)));
  const h1 = banner || heading;
  // One-liner: a tagline heading or paragraph with real text.
  const lead = [...root.querySelectorAll("h1, h2, h3, p")].find((p) => p !== h1 && p.textContent.trim().length > 40);
  const hero = imgs.find((i) => i !== banner && i.naturalWidth >= 400);
  const pre = [...root.querySelectorAll("pre")].find((p) => install.test(p.textContent));
  return {
    name: { text: h1?.alt || h1?.textContent.trim(), kind: h1 === banner ? "banner" : "heading", ...box(h1) },
    oneLiner: { text: lead?.textContent.trim().slice(0, 140), ...box(lead) },
    hero: hero ? { src: hero.getAttribute("src"), loaded: hero.complete && hero.naturalWidth > 0, ...box(hero) } : null,
    install: pre ? { text: pre.textContent.trim().split("\n")[0], ...box(pre) } : null,
  };
}

function judge(m, fold) {
  const ok = (x, edge = "bottom") => !!x && x[edge] != null && x[edge] <= fold;
  return {
    name: ok(m.name),
    oneLiner: ok(m.oneLiner),
    hero: !!m.hero?.loaded && ok(m.hero, "top"), // a hero that starts above the fold counts
    install: ok(m.install),
  };
}

export async function firstScreen(o) {
  const out = path.resolve(o.out || ".storefront");
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const report = { source: o["github-url"] || o.readme, viewports: {} };
  try {
    let url, offset = 0;
    if (o["github-url"]) {
      url = o["github-url"];
    } else {
      const readme = path.resolve(o.readme || "README.md");
      const body = await renderGfm(await fs.readFile(readme, "utf8"), o.repo);
      const css = await fs.readFile(path.join(here, "../templates/github-markdown-light.css"), "utf8");
      const file = path.join(out, "rendered.html");
      await fs.writeFile(
        file,
        `<!doctype html><meta charset="utf-8"><base href="${pathToFileURL(path.dirname(readme))}/"><style>${css}
        body{margin:0;background:#fff}.markdown-body{box-sizing:border-box;max-width:902px;margin:0 auto;padding:32px} /* GitHub repo page README column is ~838px wide at 1280 */
        @media(max-width:767px){.markdown-body{padding:16px}}</style><article class="markdown-body">${body}</article>`,
      );
      url = pathToFileURL(file).href;
    }
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: "networkidle" });
      let scrolledTo = 0;
      if (o["github-url"]) {
        // On a repo page the README sits under the file list; measure how far a visitor must scroll.
        // Leave room for the sticky README tab bar (~56px) so the H1 is not hidden.
        scrolledTo = await page.evaluate(() => {
          const el = document.querySelector("article.markdown-body");
          return Math.round(el.getBoundingClientRect().top + window.scrollY);
        });
        await page.evaluate(([y, sticky]) => window.scrollTo(0, y - sticky), [scrolledTo, STICKY]);
        await page.waitForTimeout(300);
      }
      const m = await page.evaluate(measure, { installSrc: (o.install && RegExp(o.install).source) || INSTALL.source, offset });
      // Measurements are relative to the README top; on GitHub the page is scrolled STICKY px above it.
      const fold = vp.height - (o["github-url"] ? STICKY : 0);
      const checks = judge(m, fold);
      const shot = path.join(out, `first-screen-${name}.png`);
      await page.screenshot({ path: shot });
      report.viewports[name] = { ...vp, fold, readmeStartsAtY: o["github-url"] ? scrolledTo : 0, checks, pass: Object.values(checks).every(Boolean), measured: m, screenshot: shot };
      await page.close();
    }
  } finally {
    await browser.close();
  }
  report.pass = report.viewports.desktop.pass;
  await fs.writeFile(path.join(out, "first-screen.json"), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await firstScreen(args);
  for (const [k, v] of Object.entries(r.viewports))
    console.log(`${k.padEnd(8)} ${v.pass ? "PASS" : "FAIL"}  ${Object.entries(v.checks).map(([c, ok]) => `${ok ? "✓" : "✗"}${c}`).join(" ")}${v.readmeStartsAtY ? `  (README starts at y=${v.readmeStartsAtY})` : ""}  → ${v.screenshot}`);
  process.exit(r.pass ? 0 : 1);
}
