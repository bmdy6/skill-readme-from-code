import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { capture } from "./lib/capture.mjs";
import { renderArt } from "./lib/art.mjs";
import { write, escape } from "./lib/io.mjs";
const base = path.resolve("docs/design");
await capture({
  repo: base,
  work: base,
  id: "moss",
  command: "node example.mjs",
});
for (const [name, title, lines] of [
  [
    "input",
    "Daily notes",
    ["Meeting ideas", "Draft outline", "Reading highlights"],
  ],
  [
    "output",
    "Daily digest",
    ["Ideas to develop", "A clear next step", "Sources kept with each note"],
  ],
])
  await write(
    path.join(base, `gallery-${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#f6f6f3"/><rect x="24" y="24" width="752" height="352" rx="14" fill="white" stroke="#dedfd9"/><text x="56" y="90" fill="#1c1e1b" font-family="sans-serif" font-size="38" font-weight="bold">${title}</text>${lines.map((l, i) => `<text x="56" y="${160 + i * 70}" fill="#586052" font-family="sans-serif" font-size="34">${l}</text>`).join("")}</svg>`,
  );
for (const name of ["input", "output"]) {
  const translations = {
    "Daily notes": "每日笔记",
    "Daily digest": "每日摘要",
    "Meeting ideas": "会议想法",
    "Draft outline": "草稿提纲",
    "Reading highlights": "阅读摘录",
    "Ideas to develop": "待发展的想法",
    "A clear next step": "明确的下一步",
    "Sources kept with each note": "每条笔记保留来源",
  };
  let svg = await fs.readFile(path.join(base, `gallery-${name}.svg`), "utf8");
  for (const [en, zh] of Object.entries(translations))
    svg = svg.replace(en, zh);
  await write(path.join(base, `gallery-${name}.zh-CN.svg`), svg);
}
const item = {
  title: { en: "Moss daily digest", "zh-CN": "青苔每日摘要" },
  subtitle: {
    en: "Turn scattered notes into a daily digest.",
    "zh-CN": "将零散笔记整理成每日摘要。",
  },
  prompt: {
    en: "Organize these notes into a digest I can act on.",
    "zh-CN": "把这些笔记整理成可付诸行动的摘要。",
  },
  captureId: "moss",
  fixture: true,
  steps: [
    { en: "Read the notes", "zh-CN": "阅读笔记" },
    { en: "Choose a focus", "zh-CN": "选择主题" },
    { en: "Save the digest", "zh-CN": "保存摘要" },
  ],
  details: [
    { en: "Keep the source with every idea.", "zh-CN": "每个想法都保留来源。" },
    { en: "Group ideas around one topic.", "zh-CN": "围绕主题归纳想法。" },
    { en: "Leave a clear next step.", "zh-CN": "留下明确的下一步。" },
  ],
};
await write(path.join(base, "art.json"), {
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
    illustration: ["hero-screens", "strip-3"].includes(template),
    screens:
      template === "hero-screens"
        ? [
            { en: "gallery-input.svg", "zh-CN": "gallery-input.zh-CN.svg" },
            { en: "gallery-output.svg", "zh-CN": "gallery-output.zh-CN.svg" },
          ]
        : undefined,
  })),
});
const m = await renderArt({
  spec: path.join(base, "art.json"),
  out: path.join(base, "templates"),
  work: base,
});
if (m.files.some((f) => Object.values(f.checks).some((v) => v !== "pass")))
  throw Error("Gallery self-check failed");
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await p.setContent(
    `<style>body{margin:0;padding:24px;background:#dedfd9;font:16px system-ui}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.item{background:white;padding:12px;border-radius:8px}.item img{width:100%}.item p{margin:0 0 10px}</style><div class="grid">${m.files.map((f) => `<div class="item"><p>${escape(f.file)}</p><img src="${pathToFileURL(path.join(base, "templates", f.file)).href}"></div>`).join("")}</div>`,
  ); // file images need a file origin
  await write(path.join(base, "templates/overview.html"), await p.content());
  await p.goto(pathToFileURL(path.join(base, "templates/overview.html")).href);
  await p.screenshot({
    path: path.join(base, "templates-v1.png"),
    fullPage: true,
  });
  await fs.rm(path.join(base, "templates/overview.html"));
} finally {
  await browser.close();
}
