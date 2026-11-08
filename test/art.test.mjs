import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { renderArt, inspectArt } from "../scripts/lib/art.mjs";
import { write, json } from "../scripts/lib/io.mjs";
import { runCopy } from "../scripts/lib/execute.mjs";
test("terminal output cannot be handwritten", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-art-"));
  await write(path.join(dir, "art.json"), {
    images: [
      {
        id: "hero",
        template: "hero-terminal",
        title: { en: "Moss", "zh-CN": "青苔" },
        output: "invented",
      },
    ],
  });
  await assert.rejects(
    renderArt({ spec: path.join(dir, "art.json"), out: path.join(dir, "out") }),
    /capture/i,
  );
});
test("all six templates produce four checked variants", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-six-"));
  const capture = await runCopy(
    "evals/fixtures/clean",
    `node index.mjs
node -p "'Package: '+require('./package.json').name"
node -p "'Version: '+require('./package.json').version"
node -p "'License: '+require('./package.json').license"`,
  );
  await write(path.join(dir, "captures/demo.json"), { id: "demo", ...capture });
  const item = {
    title: { en: "Moss daily notes", "zh-CN": "青苔每日笔记" },
    subtitle: {
      en: "Turn scattered notes into a daily digest.",
      "zh-CN": "将零散笔记整理成每日摘要。",
    },
    prompt: {
      en: "Organize my notes into a daily digest.",
      "zh-CN": "把我的笔记整理成每日摘要。",
    },
    captureId: "demo",
    steps: [
      { en: "Read notes", "zh-CN": "阅读笔记" },
      { en: "Choose a focus", "zh-CN": "选择主题" },
      { en: "Save the digest", "zh-CN": "保存摘要" },
    ],
  };
  await write(path.join(dir, "art.json"), {
    images: [
      "hero-terminal",
      "hero-prompt",
      "hero-code",
      "hero-screens",
      "strip-3",
      "social",
    ].map((template) => ({
      ...item,
      id: template,
      template,
      illustration: template === "hero-screens",
      screens:
        template === "hero-screens"
          ? ["preview.svg", "preview.svg"]
          : undefined,
    })),
  });
  await fs.copyFile(
    "evals/fixtures/clean/hero.svg",
    path.join(dir, "preview.svg"),
  );
  const r = await renderArt({
    spec: path.join(dir, "art.json"),
    out: path.join(dir, "out"),
    work: dir,
  });
  assert.equal(r.files.length, 24);
  for (const f of r.files) {
    assert.ok(
      Object.values(f.checks).every((v) => v === "pass"),
      JSON.stringify(f),
    );
    assert.match(f.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    (await json(path.join(dir, "out/art-manifest.json"))).files.length,
    24,
  );
});

test("titles shrink to fit but retain overflow failures at the readable floor", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-fit-"));
  await write(path.join(dir, "art.json"), {
    images: [
      {
        id: "fit",
        template: "social",
        title: { en: "M".repeat(40), "zh-CN": "宽".repeat(40) },
        subtitle: { en: "Real output with readable titles.", "zh-CN": "标题保持可读，输出仍可检查。" },
        illustration: true,
        result: { en: "node index.mjs", "zh-CN": "node index.mjs" },
      },
      {
        id: "too-wide",
        template: "social",
        title: { en: "M".repeat(500), "zh-CN": "M".repeat(500) },
        subtitle: { en: "Still report overflow.", "zh-CN": "仍需报告溢出。" },
        illustration: true,
        result: { en: "node index.mjs", "zh-CN": "node index.mjs" },
      },
    ],
  });
  const r = await renderArt({ spec: path.join(dir, "art.json"), out: path.join(dir, "out") });
  for (const f of r.files) {
    assert.equal(f.checks.overflow, f.file.startsWith("fit-") ? "pass" : "fail", JSON.stringify(f));
    assert.equal(f.checks.fontSize, "pass");
    assert.equal(f.checks.mainText, "pass");
  }
});

async function inspectFixture(t, content, style = "") {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<style>
    body { margin: 0; color: #111; background: #fff; }
    .frame { width: 900px; padding: 40px 28px; }
    h1 { margin: 0; font: bold 28px/1.2 Arial, sans-serif; }
    ${style}
  </style><main class="frame">${content}</main>`);
  return page;
}

test("subpixel text overshoot does not accumulate rounded parent overflow", async (t) => {
  const page = await inspectFixture(t, '<div class="title"><h1>Moss daily notes</h1></div>');
  const overshoot = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const range = document.createRange();
    range.selectNodeContents(h1);
    // Use this environment's real font metrics: each edge extends by at most 1px.
    h1.style.lineHeight = `${range.getBoundingClientRect().height - 1.5}px`;
    const text = range.getBoundingClientRect();
    const box = h1.getBoundingClientRect();
    // Reproduce the server's rounded ancestor metrics independently of fonts.
    const title = h1.parentElement;
    Object.defineProperty(title, "scrollHeight", { value: 67 });
    Object.defineProperty(title, "clientHeight", { value: 65 });
    return { top: box.top - text.top, bottom: text.bottom - box.bottom };
  });
  assert.ok(overshoot.top > 0 && overshoot.top <= 1, JSON.stringify(overshoot));
  assert.ok(overshoot.bottom > 0 && overshoot.bottom <= 1, JSON.stringify(overshoot));
  const result = await inspectArt(page);
  assert.equal(result.checks.overflow, "pass", JSON.stringify(result.problems));
  assert.ok(!result.problems.overflow.includes("DIV.title"));
});

test("fixed-height containers still report clipped direct and nested text", async (t) => {
  const page = await inspectFixture(t,
    '<div class="direct">Several lines of text<br>cannot fit here</div>' +
    '<div class="nested"><p>Several lines of text<br>cannot fit here</p></div>',
    '.direct,.nested { height: 12px; overflow: hidden; font: 18px/28px Arial; } p { margin: 0; }',
  );
  const result = await inspectArt(page);
  assert.equal(result.checks.overflow, "fail");
  assert.ok(result.problems.overflow.includes("DIV.direct"));
  assert.ok(result.problems.overflow.includes("DIV.nested"));
});

test("frame boundary overflow is checked on all four edges", async (t) => {
  const page = await inspectFixture(t,
    '<div class="top"></div><div class="bottom"></div><div class="left"></div><div class="right"></div>',
    '.frame { position: relative; width: 300px; height: 200px; padding: 0; }' +
    '.frame div { position: absolute; width: 10px; height: 10px; }' +
    '.top { top: -2px; } .bottom { bottom: -2px; } .left { left: -2px; } .right { right: -2px; }',
  );
  const result = await inspectArt(page);
  for (const edge of ["top", "bottom", "left", "right"])
    assert.ok(result.problems.overflow.includes(`DIV.${edge}`), edge);
});
