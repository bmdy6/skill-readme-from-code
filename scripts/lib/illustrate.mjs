import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { readmeDocuments, json, write, hash, escape } from "./io.mjs";
import { headings, badges, shellBlocks, images } from "./markdown.mjs";
import { firstScreen } from "./screen.mjs";

const baselineFile = (o) => path.join(o.work, "illustrate-baseline.json");
export async function illustrateBaseline(o) {
  const file = baselineFile(o);
  const baseline = { version: 1, readmes: await readmeDocuments(o.repo) };
  await fs.mkdir(o.work, { recursive: true });
  await fs.writeFile(file, JSON.stringify(baseline, null, 2) + "\n", {
    flag: "wx",
  });
  return baseline;
}
export function illustrationBlock(i) {
  const size = i.width ? ` width="${Number(i.width)}"` : "";
  return `<!-- readme-illustrate:${i.id} -->\n<img src="${escape(i.file)}" alt="${escape(i.alt)}"${size}>\n\n${i.caption}\n<!-- /readme-illustrate:${i.id} -->\n`;
}
export async function verifyIllustrate(o) {
  const baseline = await json(baselineFile(o));
  if (!baseline?.readmes?.length)
    throw Error("Run illustrate baseline before editing");
  const spec = await json(o.spec || path.join(o.work, "illustrate.json"));
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
      for (const i of spec.images.filter((i) => i.readme === d.file)) {
        const block = illustrationBlock(i);
        if (restored.split(block).length !== 2)
          preservation.push(
            `${d.file}: missing/duplicate or modified block ${i.id}`,
          );
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
      screens.push({ readme: d.file, ...screen });
    }
    for (const i of spec.images) {
      try {
        if (!i.alt?.trim() || !i.caption?.trim())
          throw Error("alt and caption required");
        if (
          !["illustration", "web-app", "command-run"].includes(
            i.source?.kind,
          ) ||
          !i.source.command?.trim() ||
          !i.source.data?.trim()
        )
          throw Error("source kind, command and data required");
        if (
          i.source.kind === "illustration" &&
          !/illustration|示意图/i.test(i.caption)
        )
          throw Error("diagram caption must label illustration");
        if (
          i.source.kind === "web-app" &&
          (!i.source.url || !i.source.viewport || !i.source.sha256)
        )
          throw Error("web source requires URL, viewport and sha256");
        if (path.isAbsolute(i.file) || i.file.split(/[\\/]/).includes(".."))
          throw Error("image must be repository-local");
        const root = await fs.realpath(o.repo),
          file = await fs.realpath(path.join(root, i.file));
        if (!file.startsWith(root + path.sep))
          throw Error("image escapes repository");
        const bytes = await fs.readFile(file);
        if (bytes.length >= 400000) throw Error("image must be <400KB");
        if (i.source.sha256 && hash(bytes) !== i.source.sha256)
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
  for (const s of screens)
    if (!s.viewports.desktop.checks.install)
      screens[screens.indexOf(s)].installIssue =
        "complete installation block is below fold or missing";
  add(
    "first-screen",
    screens
      .filter((s) => s.installIssue)
      .map((s) => `${s.readme}: ${s.installIssue}`),
    { screens },
  );
  const result = {
    mode: "illustrate",
    ok: checks.every((c) => c.status === "pass"),
    checks,
  };
  await write(path.join(o.work, "illustrate-verify.json"), result);
  return result;
}
