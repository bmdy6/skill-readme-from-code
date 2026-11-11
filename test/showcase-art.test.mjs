import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { renderArt, inspectArt } from "../scripts/lib/art.mjs";
import { prepareBanner, bannerValues } from "../scripts/lib/art-banner.mjs";
import { write, json, hash } from "../scripts/lib/io.mjs";

async function fixture(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-showcase-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  const out = path.join(repo, "docs/readme");
  await write(path.join(repo, "README.md"), "## Quick start\n\nKeep these instructions.\n");
  await write(path.join(repo, "README.zh-CN.md"), "## 快速开始\n\n保留这些说明。\n");
  const localized = (en, zh) => ({ en, "zh-CN": zh });
  const item = {
    id: "banner", template: "showcase-banner", captureId: "demo", fixture: true,
    title: "Moss", subtitle: localized("Turn notes into a digest.", "从笔记生成摘要。"),
    eyebrow: localized("LOCAL MCP", "本地 MCP"),
    description: localized("Search source lines, inspect the diff, then decide what to save.", "搜索原文行号、预览修改，再决定保存哪些内容。"),
    integrations: ["MCP", "Markdown"],
    metrics: [{ field: "tools", label: localized("MCP tools", "MCP 工具") }, { field: "matches", label: localized("Matched notes", "命中笔记") }],
    outputFields: ["query", "tools", "matches", "unchanged"],
    caption: localized("Recorded synthetic demo.", "合成示例的真实运行。"),
    readmes: { "README.md": "en", "README.zh-CN.md": "zh-CN" },
  };
  const capture = { id: "demo", command: "node demo.mjs", stdout: '{"query":"question","tools":10,"matches":1,"unchanged":true}\n', stderr: "", exitCode: 0 };
  await write(path.join(out, "captures/demo.json"), capture);
  const spec = path.join(out, "art.json");
  await write(spec, { images: [item] });
  return { repo, out, item, capture, spec };
}
test("art CLI renders four measured banners and updates both README files idempotently", async t => {
  const f = await fixture(t);
  const result = spawnSync(process.execPath, ["scripts/run.mjs", "art", "--repo", f.repo, "--spec", f.spec, "--out", f.out], { encoding: "utf8" });
  const manifest = await json(path.join(f.out, "art-manifest.json"));
  assert.equal(result.status, 0, JSON.stringify(manifest));
  assert.match(result.stdout, /4 images rendered/);
  assert.equal(manifest.files.length, 4);
  for (const file of manifest.files) {
    assert.ok(Object.values(file.checks).every(s => s === "pass"), JSON.stringify(file));
    assert.ok(file.contentRatio >= 0.63, JSON.stringify(file));
    assert.equal(file.sha256, hash(await fs.readFile(path.join(f.out, file.file))));
    assert.equal(file.banner.metrics[0].value, 10);
  }
  const before = await fs.readFile(path.join(f.repo, "README.md"), "utf8");
  assert.match(before, /<h1><picture>/);
  assert.match(before, /srcset="docs\/readme\/banner-dark\.png"/);
  assert.match(before, /src="docs\/readme\/banner-light\.png"/);
  assert.match(before, /Moss — Turn notes into a digest\./);
  assert.ok(before.endsWith("## Quick start\n\nKeep these instructions.\n"));
  const zh = await fs.readFile(path.join(f.repo, "README.zh-CN.md"), "utf8");
  assert.match(zh, /banner-light\.zh-CN\.png/);
  assert.match(zh, /从笔记生成摘要/);
  await renderArt(f);
  assert.equal(await fs.readFile(path.join(f.repo, "README.md"), "utf8"), before);
});

test("banner keeps density headroom with installed CJK sans and serif fonts", async t => {
  const f = await fixture(t);
  const banner = await prepareBanner(f.item, f.capture, f.repo, f.out);
  const css = await fs.readFile(new URL("../templates/art/base.css", import.meta.url), "utf8");
  const template = await fs.readFile(new URL("../templates/art/showcase-banner.html", import.meta.url), "utf8");
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const probe = await browser.newPage();
  const fonts = await probe.evaluate(async () => {
    const available = [];
    for (const font of ["Noto Sans CJK SC", "Noto Serif CJK SC", "PingFangSC-Regular"])
      try { await new FontFace("Banner CJK test", `local("${font}")`).load(); available.push(font); }
      catch { /* Do not silently measure a fallback as the requested font. */ }
    return available;
  });
  await probe.close();
  if (!fonts.length) return t.skip("No supported CJK font is installed");
  for (const font of fonts)
    await t.test(font, async t => {
      const page = await browser.newPage();
      t.after(() => page.close());
      for (const lang of ["en", "zh-CN"])
        for (const theme of ["light", "dark"]) {
          const text = v => typeof v === "string" ? v : v[lang];
          const values = {
            ...bannerValues(f.item, banner, text),
            title: text(f.item.title), subtitle: text(f.item.subtitle),
            terminalLabel: lang === "en" ? "terminal capture" : "终端记录",
            command: f.capture.command,
          };
          await page.setContent(`<style>${css}
            .banner-pitch > :not(.banner-integrations), .banner-metric > *, .banner-terminal .head {
              font-family: "Banner CJK test", sans-serif !important;
            }
          </style><body class="${theme}"><main class="frame showcase-banner">${template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key])}</main></body>`);
          await page.evaluate(async font => {
            const face = await new FontFace("Banner CJK test", `local("${font}")`).load();
            document.fonts.add(face);
            await document.fonts.ready;
          }, font);
          const result = await inspectArt(page);
          t.diagnostic(`${lang}/${theme}: ${(result.contentRatio * 100).toFixed(2)}% content`);
          assert.ok(result.contentRatio >= 0.63, JSON.stringify(result));
          assert.ok(Object.values(result.checks).every(s => s === "pass"), JSON.stringify(result));
        }
    });
});
for (const mode of ["missing-capture", "failed-capture", "missing-field", "invented-metric", "escape-readme", "bad-markers"])
  test("banner rejects " + mode + " before changing README text", async t => {
    const f = await fixture(t);
    if (mode === "missing-capture") delete f.item.captureId;
    if (mode === "failed-capture") f.capture.exitCode = 1;
    if (mode === "missing-field") f.item.outputFields = ["absent"];
    if (mode === "invented-metric") f.item.metrics[0] = { value: 999, label: "Fake" };
    if (mode === "escape-readme") f.item.readmes = { "../README.md": "en" };
    if (mode === "bad-markers") await fs.appendFile(path.join(f.repo, "README.md"), "<!-- readme-from-code:banner:banner:start -->");
    await write(f.spec, { images: [f.item] });
    await write(path.join(f.out, "captures/demo.json"), f.capture);
    const before = await fs.readFile(path.join(f.repo, "README.md"), "utf8");
    await assert.rejects(renderArt(f));
    assert.equal(await fs.readFile(path.join(f.repo, "README.md"), "utf8"), before);
  });
test("failed banner image checks leave the README untouched", async t => {
  const f = await fixture(t);
  f.item.integrations = ["M".repeat(500)];
  await write(f.spec, { images: [f.item] });
  const before = await fs.readFile(path.join(f.repo, "README.md"), "utf8");
  const result = await renderArt(f);
  assert.ok(result.files.some(file => file.checks.overflow === "fail"));
  assert.equal(await fs.readFile(path.join(f.repo, "README.md"), "utf8"), before);
});
test("banner rejects README and output-directory symlinks outside the repository", async t => {
  const f = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-banner-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await write(path.join(outside, "README.md"), "Keep outside data.");
  await fs.unlink(path.join(f.repo, "README.md"));
  await fs.symlink(path.join(outside, "README.md"), path.join(f.repo, "README.md"));
  await assert.rejects(renderArt(f), /escapes/);
  await fs.unlink(path.join(f.repo, "README.md"));
  await write(path.join(f.repo, "README.md"), "Keep local data.");
  await fs.symlink(outside, path.join(f.repo, "external"));
  await assert.rejects(renderArt({ ...f, out: path.join(f.repo, "external/new") }), /inside/);
  assert.equal(await fs.readFile(path.join(outside, "README.md"), "utf8"), "Keep outside data.");
});
test("banner creates a new output directory", async t => {
  const f = await fixture(t);
  const result = await renderArt({ ...f, out: path.join(f.repo, "new-art") });
  assert.equal(result.files.length, 4);
  assert.match(await fs.readFile(path.join(f.repo, "README.md"), "utf8"), /new-art\/banner-light.png/);
});

test("omitting the README map renders without changing text", async t => {
  const f = await fixture(t);
  delete f.item.readmes;
  await write(f.spec, { images: [f.item] });
  const before = await fs.readFile(path.join(f.repo, "README.md"), "utf8");
  const result = await renderArt(f);
  assert.equal(result.files.length, 4);
  assert.equal(await fs.readFile(path.join(f.repo, "README.md"), "utf8"), before);
});
