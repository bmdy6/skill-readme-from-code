import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { readmeDocuments, json, write, hash, escape } from "./io.mjs";
import { headings, badges, shellBlocks, images } from "./markdown.mjs";
import { firstScreen } from "./screen.mjs";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], {encoding:"utf8"});
const baselineFile = (o) => path.join(o.work, "illustrate-baseline.json");
export async function illustrateBaseline(o) {
  const file = baselineFile(o);
  const commit = git(o.repo, ["rev-parse", "HEAD"]).trim();
  const readmes = [];
  for (const d of await readmeDocuments(o.repo)) {
    const blob = git(o.repo, ["rev-parse", `${commit}:${d.file}`]).trim();
    if (git(o.repo, ["show", `${commit}:${d.file}`]) !== d.text)
      throw Error(`README must be committed before baseline: ${d.file}`);
    readmes.push({ file: d.file, blob });
  }
  const baseline = { version: 2, commit, readmes };
  await fs.mkdir(o.work, { recursive: true });
  await fs.writeFile(file, JSON.stringify(baseline, null, 2) + "\n", {
    flag: "wx",
  });
  return baseline;
}
export function illustrationBlock(i) {
  if (Array.isArray(i.images)) {
    const cells = i.images.map(x => `<td align="center"><a href="${escape(x.file)}"><img src="${escape(x.file)}" alt="${escape(x.alt)}" width="250"></a><br>${escape(x.caption)}</td>`);
    const rows=[];
    for(let n=0;n<cells.length;n+=3) rows.push(`<tr>${cells.slice(n,n+3).join("")}</tr>`);
    return `<!-- readme-illustrate:${i.id} -->\n<table>\n${rows.join("\n")}\n</table>\n<!-- /readme-illustrate:${i.id} -->\n`;
  }
  const size = i.width ? ` width="${Number(i.width)}"` : "";
  return `<!-- readme-illustrate:${i.id} -->\n<img src="${escape(i.file)}" alt="${escape(i.alt)}"${size}>\n\n${i.caption}\n<!-- /readme-illustrate:${i.id} -->\n`;
}
export async function verifyIllustrate(o) {
  const spec = await json(o.spec || path.join(o.work, "illustrate.json"));
  const baseline = spec?.baseline || await json(baselineFile(o));
  if (!baseline?.readmes?.length || !/^[a-f0-9]{40}$/.test(baseline.commit || ""))
    throw Error("Run illustrate baseline before editing (commit/blob references required)");
  for (const d of baseline.readmes) {
    if (!/^README[.\w-]*\.md$/.test(d.file) || !/^[a-f0-9]{40}$/.test(d.blob || "") || git(o.repo,["rev-parse",`${baseline.commit}:${d.file}`]).trim() !== d.blob)
      throw Error("Invalid baseline blob reference");
    d.text = git(o.repo,["show",`${baseline.commit}:${d.file}`]);
  }
  if (!Array.isArray(spec?.images))
    throw Error("illustrate.json requires images array");
  const brief = await json(o.brief || path.join(o.work, "brief.json"), {});
  const checks = [],
    add = (id, issues, extra = {}) =>
      checks.push({
        id,
        status: issues.length ? "fail" : "pass",
        issues,
        ...extra,
      });
  const docs = await readmeDocuments(o.repo, brief),
    preservation = [],
    assetIssues = [],
    placementIssues = [],
    screens = [];
  for (const d of docs) {
    const install = brief.installs?.[d.file] || brief.install;
    if (!install || (!install.block && !install.command && !install.url))
      throw Error(`Explicit install required for ${d.file}`);
  }
  if (
    JSON.stringify(docs.map((d) => d.file)) !==
    JSON.stringify(baseline.readmes.map((d) => d.file))
  )
    preservation.push("README set changed");
  const ids = new Set();
  for (const i of spec.images) {
    if (!/^[\w-]+$/.test(i.id || "") || ids.has(i.id))
      assetIssues.push("Invalid or duplicate image id");
    ids.add(i.id);
    if (!baseline.readmes.some((d) => d.file === i.readme))
      assetIssues.push(`${i.id}: unknown README`);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const d of docs) {
      const old = baseline.readmes.find((b) => b.file === d.file);
      if (!old) continue;
      let restored = d.text;
      const entries = spec.images.filter(i => i.readme === d.file);
      if (entries.filter(i=> /synthetic data|no model calls|合成数据|未调用模型/i.test(i.caption || "")).length > 1)
        assetIssues.push(`${d.file}: synthetic/model-call declaration must appear once`);
      const blocks = entries.filter(i => !i.group).map(illustrationBlock);
      for (const group of new Set(entries.map(i=>i.group).filter(Boolean)))
        blocks.push(illustrationBlock({id:group,images:entries.filter(i=>i.group===group)}));
      for (const block of blocks) {
        if (restored.split(block).length !== 2)
          preservation.push(`${d.file}: missing/duplicate or modified block`);
        else restored = restored.replace(block, "");
      }
      if (restored !== old.text)
        preservation.push(`${d.file}: original bytes changed`);
      for (const [name, fn] of [
        ["H2", (s) => headings(s).filter((h) => h.depth === 2)],
        ["badges", badges],
        ["commands", shellBlocks],
      ])
        if (JSON.stringify(fn(restored)) !== JSON.stringify(fn(old.text)))
          preservation.push(`${d.file}: ${name} changed`);
      const screen = await firstScreen({
        repo: o.repo,
        work: path.join(o.shots || path.join(o.work, "screens"), d.file),
        readme: d.file,
        install: brief.installs?.[d.file] || brief.install,
        brief,
        local: !!o.local,
        offline: !!o.offline,
      });
      const before = await firstScreen({repo:o.repo,work:path.join(o.work,"baseline-screens",d.file),readme:d.file,markdown:old.text,install:brief.installs?.[d.file] || brief.install,brief,local:!!o.local,offline:!!o.offline});
      const desktop = screen.viewports.desktop, installBox = desktop.items.install;
      const beforeInstall = [];
      for (const i of entries) {
        const img = desktop.images.find(x => decodeURI(x.src).endsWith("/"+i.file));
        if (!img || !installBox) { placementIssues.push(`${d.file}: image/install geometry missing`); continue; }
        if (img.top < installBox.bottom) {
          beforeInstall.push(i);
          if (img.height > 420) placementIssues.push(`${i.id}: hero rendered height exceeds 420px`);
          if (i.placement === "step" || i.group) placementIssues.push(`${i.id}: step image must follow installation`);
        }
      }
      if (beforeInstall.length > 1) placementIssues.push(`${d.file}: at most one image before installation`);
      screens.push({ readme: d.file, baseline:before.viewports.desktop, ...screen });

    }
    for (const i of spec.images) {
      try {
        if (/[\r\n]/.test(i.caption || "")) throw Error("caption must be one line");
        if (!i.alt?.trim() || !i.caption?.trim())
          throw Error("alt and caption required");
        if (i.source) {
          if (!["illustration","web-app","command-run"].includes(i.source.kind) || !i.source.command?.trim() || !i.source.data?.trim())
            throw Error("source kind, command and data required");
          if (i.source.kind === "illustration" && !/illustration|示意图/i.test(i.caption))
            throw Error("diagram caption must label illustration");
          if (i.source.kind === "web-app" && (!i.source.url || !i.source.viewport || !i.source.sha256))
            throw Error("web source requires URL, viewport and sha256");
        } else {
          if (!spec.sources || path.isAbsolute(spec.sources) || spec.sources.split(/[\\/]/).includes("..")) throw Error("SOURCES.md required");
          const root = await fs.realpath(o.repo), sourcePath = await fs.realpath(path.join(root,spec.sources));
          if (!sourcePath.startsWith(root+path.sep)) throw Error("source escapes repository");
          const sources = await fs.readFile(sourcePath,"utf8");
          if (!i.sha256 || !sources.includes(path.basename(i.file)) || !sources.includes(i.sha256)) throw Error("SOURCES.md must identify image and hash");
        }
        if (path.isAbsolute(i.file) || i.file.split(/[\\/]/).includes(".."))
          throw Error("image must be repository-local");
        const root = await fs.realpath(o.repo),
          file = await fs.realpath(path.join(root, i.file));
        if (!file.startsWith(root + path.sep))
          throw Error("image escapes repository");
        const bytes = await fs.readFile(file);
        if (bytes.length >= 400000) throw Error("image must be <400KB");
        if ((i.sha256 || i.source?.sha256) && hash(bytes) !== (i.sha256 || i.source?.sha256))
          throw Error("source hash mismatch");
        const doc = docs.find((d) => d.file === i.readme);
        if (
          !doc ||
          !images(doc.text).some((x) => x.src === i.file && x.alt === i.alt)
        )
          throw Error("image not reachable with declared alt");
        const page = await browser.newPage();
        try {
          await page.setContent(
            `<img src="data:image/${path.extname(i.file).slice(1) === "svg" ? "svg+xml" : path.extname(i.file).slice(1)};base64,${bytes.toString("base64")}">`,
          );
          await page.waitForFunction(() => document.images[0].complete);
          const size = await page.evaluate(() => ({
            width: document.images[0].naturalWidth,
            height: document.images[0].naturalHeight,
          }));
          if (
            size.width < 200 ||
            size.width > 3840 ||
            size.height < 40 ||
            size.height > 2160
          )
            throw Error("image dimensions outside 200–3840 × 40–2160");
          i.measured = { ...size, bytes: bytes.length, sha256: hash(bytes) };
        } finally {
          await page.close();
        }
      } catch (e) {
        assetIssues.push(`${i.id}: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  add("preservation", preservation, {
    compared: ["original bytes", "H2", "badges", "commands"],
  });
  add("images", assetIssues, { images: spec.images });
  add("placement", placementIssues);
  const warnings = screens.filter(s => s.baseline.items.install && !s.baseline.checks.install)
    .map(s => `${s.readme}: baseline installation already below fold; warning`);
  const installIssues = screens.filter(s => !s.baseline.items.install || !s.viewports.desktop.items.install)
    .map(s => `${s.readme}: explicit installation block missing`);
  installIssues.push(...screens.filter(s => s.baseline.checks.install && !s.viewports.desktop.checks.install)
    .map(s => `${s.readme}: installation regressed below fold`));
  add("first-screen", installIssues, {screens,warnings});
  const result = {
    mode: "illustrate",
    ok: checks.every((c) => c.status === "pass"),
    checks,
  };
  await write(path.join(o.work, "illustrate-verify.json"), result);
  return result;
}
