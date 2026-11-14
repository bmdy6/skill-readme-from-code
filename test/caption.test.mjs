import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { leadText } from "../scripts/lib/markdown.mjs";
import { staticChecks } from "../scripts/lib/verify.mjs";
import { firstScreen } from "../scripts/lib/screen.mjs";

const caption = "Recorded run: node example.mjs, using the bundled synthetic fixture on 2026-11-11. This describes the image, rather than positioning the project.";
for (const image of [
  "![Output](hero.svg)",
  '<picture><img src="hero.svg" alt="Output"></picture>',
  '<p align="center"><img src="hero.svg" alt="Output"></p>',
]) test("lead skips the caption after " + image, () => {
  assert.equal(leadText(`# Moss\n\n${image}\n\n${caption}\n\nTurn notes into a digest.`), "Turn notes into a digest.");
});
test("image captions never override a preceding tagline", () => {
  assert.equal(leadText(`# Moss\n\n**Turn notes into a digest.**\n\n![Output](hero.svg)\n\n${caption}`), "**Turn notes into a digest.**");
});
test("an image above the name does not consume the actual tagline", () => {
  assert.equal(leadText("![Logo](logo.svg)\n\n# Moss\n\nTurn notes into a digest."), "Turn notes into a digest.");
});
test("caption-only first screen has no invented positioning", () => {
  assert.equal(leadText(`# Moss\n\n![Output](hero.svg)\n\n${caption}`), undefined);
});
test("V6 checks the actual tagline after the caption", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-caption-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const prefix = `# Moss\n\n![Output](hero.svg)\n\n${caption}\n\n`;
  const facts = { facts: [], manifest: {}, images: [], workflows: [] };
  await fs.writeFile(path.join(repo, "README.md"), prefix + "Turn notes into a digest.");
  let result = await staticChecks(repo, facts, {});
  assert.deepEqual(result.find(c => c.id === "V6").issues, []);
  await fs.writeFile(path.join(repo, "README.md"), prefix + "This project makes things better.");
  result = await staticChecks(repo, facts, {});
  assert.match(result.find(c => c.id === "V6").issues.join(" "), /Generic one-liner/);
});
test("first screen measures the tagline, not a visible caption", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-caption-screen-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.writeFile(path.join(repo, "hero.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="green"/></svg>');
  const prefix = `# Moss\n\n![Output](hero.svg)\n\n${caption}\n\n`;
  const screen = (markdown) => firstScreen({ repo, work: path.join(repo, "screen"), markdown, offline: true });
  const visible = await screen(prefix + "Turn notes into a digest.");
  assert.equal(visible.viewports.desktop.checks.oneLiner, true);
  assert.ok(visible.viewports.desktop.items.oneLiner.top > visible.viewports.desktop.images[0].bottom + 50);
  const missing = await screen(prefix);
  assert.equal(missing.viewports.desktop.items.oneLiner, null);
  assert.equal(missing.viewports.desktop.checks.oneLiner, false);
});
for (const h1 of [
  '<h1><picture><source media="(prefers-color-scheme: dark)" srcset="hero.svg"><img src="hero.svg" alt="Moss — Turn notes into a digest."></picture></h1>',
  '<h1><img src="hero.svg" alt="Moss — Turn notes into a digest."></h1>',
  '# ![Moss — Turn notes into a digest.](hero.svg)',
]) test("banner heading uses its alt instead of the caption: " + h1, async (t) => {
  const md = `${h1}\n\n${caption}`;
  assert.equal(leadText(md), "Moss — Turn notes into a digest.");
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-banner-lead-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.writeFile(path.join(repo, "README.md"), md);
  await fs.writeFile(path.join(repo, "hero.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="838" height="350"><rect width="838" height="350" fill="green"/></svg>');
  const checks = await staticChecks(repo, { facts: [], manifest: {}, images: [], workflows: [] }, {});
  assert.deepEqual(checks.find(c => c.id === "V6").issues, []);
  const result = await firstScreen({ repo, work: path.join(repo, "screen"), offline: true });
  const v = result.viewports.desktop;
  for (const key of ["name", "oneLiner", "hero"]) assert.equal(v.checks[key], true, key);
  assert.deepEqual(v.items.oneLiner, v.items.hero);
});

test("status badges do not consume a following tagline", () => {
  assert.equal(leadText("# Moss\n\n![Tests](https://img.shields.io/badge/tests-pass-green)\n\nTurn notes into a digest."), "Turn notes into a digest.");
});

test("V6 rejects work-log wording and text before the title", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-worklog-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const facts = { facts: [], manifest: {}, images: [], workflows: [] };
  const v6 = async (md) => {
    await fs.writeFile(path.join(repo, "README.md"), md);
    return (await staticChecks(repo, facts, {})).find(c => c.id === "V6").issues.join(" ");
  };
  assert.equal(await v6("[中文](README.zh-CN.md)\n\n<!-- note -->\n# Moss\n\nTurn notes into a digest.\n\n```sh\necho 本轮\n```\n"), "");
  assert.match(await v6("# Moss\n\nTurn notes into a digest.\n\n本轮未调用真实模型。\n"), /Work-log wording: 本轮/);
  assert.match(await v6("# Moss\n\nTurn notes into a digest.\n\nNot tested in this round.\n"), /Work-log wording/);
  assert.match(await v6("Turn notes into a digest.\n\n# Moss\n\nTurn notes into a digest.\n"), /Text before the title/);
});
