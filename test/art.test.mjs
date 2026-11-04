import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderArt } from "../scripts/lib/art.mjs";
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
