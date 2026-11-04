import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { read, json, write, hash, escape } from "./io.mjs";
const templateDir = fileURLToPath(
  new URL("../../templates/art/", import.meta.url),
);
const names = [
  "hero-terminal",
  "hero-prompt",
  "hero-code",
  "hero-screens",
  "strip-3",
  "social",
];
const stripANSI = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
function pick(value, lang, field) {
  const s = typeof value === "object" ? value?.[lang] : value;
  if (typeof s !== "string" || !s.trim() || /undefined/.test(s))
    throw Error(`Missing ${lang} art field: ${field}`);
  return s;
}
export async function inspectArt(page) {
  return page.evaluate(() => {
    const problems = {
      overflow: [],
      fontSize: [],
      contrast: [],
      fields: [],
      mainText: [],
      density: [],
    };
    const contentRects = [];
    const rgb = (c) => {
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const lum = (a) =>
      a
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const frame = document.querySelector(".frame"),
      bounds = frame.getBoundingClientRect();
    for (const e of frame.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (
        e.scrollWidth > e.clientWidth + 1 ||
        e.scrollHeight > e.clientHeight + 1 ||
        r.right > bounds.right + 1 ||
        r.left < bounds.left - 1 ||
        r.bottom > bounds.bottom + 1
      )
        problems.overflow.push(e.tagName + "." + e.className);
      if (
        ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      )
        continue;
      const cs = getComputedStyle(e);
      if (parseFloat(cs.fontSize) < 13) problems.fontSize.push(e.textContent);
      if (
        !e.closest(
          ".head,.eyebrow,.caption,.illustration,.number,[data-label]",
        ) &&
        parseFloat(cs.fontSize) < 16
      )
        problems.mainText.push(e.textContent.slice(0, 80));
      for (const n of e.childNodes)
        if (n.nodeType === 3 && n.textContent.trim()) {
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects())
            contentRects.push({
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
            });
        }
      let b = e,
        bg;
      while (b) {
        const color = rgb(getComputedStyle(b).backgroundColor);
        if (color[3] === 255) {
          bg = color;
          break;
        }
        b = b.parentElement;
      }
      const fg = rgb(cs.color);
      if (!bg || fg[3] !== 255)
        problems.contrast.push("Unsupported translucent text/background");
      else {
        const l = [lum(fg), lum(bg)].sort((a, b) => b - a);
        if ((l[0] + 0.05) / (l[1] + 0.05) < 4.5)
          problems.contrast.push(e.textContent.slice(0, 60));
      }
    }
    for (const img of frame.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      contentRects.push({
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      });
    }
    for (const img of frame.querySelectorAll("img"))
      if (!img.complete || !img.naturalWidth)
        problems.fields.push("Broken image");
    if (/undefined|\{\{/.test(frame.textContent) || !frame.textContent.trim())
      problems.fields.push("Empty or unresolved fields");
    // Designed panels are visual content too. Never count the canvas or empty boxes.
    for (const panel of frame.querySelectorAll(".card,.bubble"))
      if (
        panel.textContent.trim() ||
        [...panel.querySelectorAll("img")].some(
          (i) => i.complete && i.naturalWidth,
        )
      ) {
        const r = panel.getBoundingClientRect();
        contentRects.push({
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        });
      }
    const contentBounds = contentRects.length
      ? {
          left: Math.min(...contentRects.map((r) => r.left)),
          top: Math.min(...contentRects.map((r) => r.top)),
          right: Math.max(...contentRects.map((r) => r.right)),
          bottom: Math.max(...contentRects.map((r) => r.bottom)),
        }
      : null;
    const contentRatio = contentBounds
      ? ((contentBounds.right - contentBounds.left) *
          (contentBounds.bottom - contentBounds.top)) /
        (bounds.width * bounds.height)
      : 0;
    if (contentRatio < 0.6)
      problems.density.push(
        `Content bounds occupy ${(100 * contentRatio).toFixed(1)}%; minimum 60%`,
      );
    return {
      contentBounds,
      contentRatio,
      checks: Object.fromEntries(
        Object.entries(problems).map(([k, v]) => [
          k,
          v.length ? "fail" : "pass",
        ]),
      ),
      problems,
      width: bounds.width,
      height: bounds.height,
    };
  });
}
export async function renderArt({ spec, out, work }) {
  spec = path.resolve(spec);
  out = path.resolve(out);
  const cfg = await json(spec);
  if (!cfg?.images?.length) throw Error("art.json needs images");
  const base = path.dirname(spec),
    cache = work || base;
  const accent = cfg.accent || "#2f6f4e";
  if (!/^#[0-9a-f]{6}$/i.test(accent))
    throw Error("accent must be a six digit hex color");
  const prepared = [];
  const seen = new Set();
  for (const item of cfg.images) {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || seen.has(item.id))
      throw Error("Art IDs must be unique safe names");
    seen.add(item.id);
    if (!names.includes(item.template))
      throw Error(`Unknown art template ${item.template}`);
    if (item.output !== undefined || item.command !== undefined)
      throw Error("Terminal command/output must reference a capture");
    let capture;
    if (item.captureId) {
      if (!/^[\w-]+$/.test(item.captureId)) throw Error("Invalid capture ID");
      capture = await json(
        path.join(cache, "captures", item.captureId + ".json"),
        await json(path.join(base, "captures", item.captureId + ".json")),
      );
      if (!capture || typeof capture.stdout !== "string")
        throw Error(`Missing capture ${item.captureId}`);
    }
    if (["hero-terminal", "hero-code"].includes(item.template) && !capture)
      throw Error(`${item.template} requires a capture ID`);
    if (item.stats) {
      const verify = await json(path.join(cache, "verify.json"));
      if (!verify) throw Error("Stats require verify.json");
      for (const field of item.stats) {
        if (!/^summary\.(pass|fail|skip)$/.test(field))
          throw Error("Unsupported verify field");
      }
    }
    if (
      ["hero-prompt", "social"].includes(item.template) &&
      !capture &&
      !item.illustration
    )
      throw Error("Result text requires capture or illustration");
    prepared.push({ item, capture });
  }
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const manifest = { schemaVersion: 1, accent, files: [] };
  try {
    for (const { item, capture } of prepared)
      for (const lang of ["en", "zh-CN"])
        for (const theme of ["light", "dark"]) {
          const zh = lang === "zh-CN",
            text = (v, f) => escape(pick(v, lang, f));
          const values = {
            title: text(item.title, "title"),
            subtitle: text(item.subtitle, "subtitle"),
            prompt:
              capture?.role === "core" && capture.input
                ? escape(
                    typeof capture.input === "string"
                      ? capture.input
                      : JSON.stringify(capture.input),
                  )
                : item.prompt
                  ? text(item.prompt, "prompt")
                  : "",
            label: item.illustration
              ? zh
                ? "示意"
                : "Illustration"
              : zh
                ? "真实运行"
                : "Recorded run",
            promptLabel:
              capture?.role === "core"
                ? zh
                  ? "原始草稿"
                  : "Original draft"
                : zh
                  ? "你告诉智能体"
                  : "You tell your agent",
            resultLabel:
              capture?.role === "core"
                ? zh
                  ? "润色后"
                  : "Polished draft"
                : zh
                  ? "你得到"
                  : "You get",
            outputClass:
              capture?.kind === "agent-run"
                ? "prose-output"
                : capture
                  ? "terminal"
                  : "illustrated-result",
            terminalLabel: zh ? "终端记录" : "terminal capture",
            inputLabel: zh ? "输入" : "Input",
            command: escape(capture?.command || ""),
            output: escape(
              capture
                ? stripANSI(
                    capture.stdout +
                      (capture.stderr ? "\n" + capture.stderr : ""),
                  ).trim()
                : ["strip-3", "hero-screens"].includes(item.template)
                  ? ""
                  : pick(item.result, lang, "result"),
            ),
            scoreLabel:
              capture?.measurements?.score !== undefined
                ? `${zh ? "风格检查" : "Style check"} ${Number(capture.measurements.score)}/100`
                : capture?.kind === "agent-run"
                  ? "Agent-run"
                  : "",
            steps: "",
          };
          if (item.template === "strip-3") {
            if (item.steps?.length !== 3)
              throw Error("strip-3 requires three steps");
            values.steps = item.steps
              .map(
                (s, i) =>
                  `<div class="card step"><div class="number">${i + 1}</div><h2>${text(s, "step")}</h2><p>${text(item.details?.[i] || s, "detail")}</p></div>${i < 2 ? '<div class="arrow">→</div>' : ""}`,
              )
              .join("");
          }
          if (item.template === "hero-screens") {
            if (item.screens?.length !== 2)
              throw Error("hero-screens needs two original local images");
            for (let i = 0; i < 2; i++) {
              const img = path.resolve(
                base,
                typeof item.screens[i] === "string"
                  ? item.screens[i]
                  : pick(item.screens[i], lang, "screen"),
              );
              const ext = path.extname(img).slice(1);
              if (!["png", "svg", "jpg", "jpeg", "webp"].includes(ext))
                throw Error("Unsupported screen file");
              const data = await fs.readFile(img);
              values[`screen${i}`] =
                `<img alt="${values.title}" src="data:image/${ext === "svg" ? "svg+xml" : ext};base64,${data.toString("base64")}">`;
            }
          }
          if (item.template === "hero-screens" && capture?.audits) {
            values.inputLabel =
              (zh ? "改前" : "Before") +
              ` · ${capture.audits.before.score}/100`;
            values.resultLabel =
              (zh ? "改后" : "After") + ` · ${capture.audits.after.score}/100`;
          }
          const template = await read(
            path.join(templateDir, item.template + ".html"),
          );
          let content = template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
            if (values[k] === undefined) throw Error(`Unknown slot ${k}`);
            return values[k];
          });
          if (
            item.template !== "hero-prompt" &&
            capture?.measurements?.score !== undefined
          )
            content += `<p class="capture-score" data-label>${zh ? "实际风格检查" : "Actual style check"}: ${Number(capture.measurements.score)}/100 · ${zh ? "不代表改稿质量" : "not a rewrite-quality score"}</p>`;
          if (item.stats) {
            const verify = await json(path.join(cache, "verify.json"));
            content += `<p class="note">${item.stats.map((f) => `${escape(f)}: ${verify.summary[f.split(".")[1]]}`).join(" · ")}</p>`;
          }
          if (item.illustration && item.template !== "social")
            content += `<p class="illustration">${zh ? "示意" : "Illustration"}</p>`;
          const page = await browser.newPage({
            viewport: {
              width: item.template === "social" ? 1280 : 900,
              height: 900,
            },
            deviceScaleFactor: item.template === "social" ? 1 : 2,
          });
          await page.route("**/*", (r) => r.abort());
          await page.setContent(
            `<!doctype html><meta charset="utf-8"><style>${await read(path.join(templateDir, "base.css"))}:root{--accent:${accent}}</style><body class="${theme}"><main class="frame ${item.template === "social" ? "social" : item.template === "strip-3" ? "strip" : ""} ${item.compact ? "compact" : ""}">${content}</main></body>`,
          );
          await page.evaluate(() => document.fonts.ready);
          if (
            item.template !== "social" &&
            ["hero-terminal", "hero-code", "hero-prompt"].includes(
              item.template,
            ) &&
            capture?.kind !== "agent-run" &&
            (capture?.stdout || "").split("\n").filter((l) => l.trim()).length <
              4
          )
            await page
              .locator(".frame")
              .evaluate((e) => (e.style.width = "640px"));
          const inspected = await inspectArt(page);
          const file = `${item.id}-${theme}${zh ? ".zh-CN" : ""}.png`;
          await page
            .locator(".frame")
            .screenshot({ path: path.join(out, file) });
          const bytes = await fs.readFile(path.join(out, file));
          inspected.checks.size = bytes.length < 1_000_000 ? "pass" : "fail";
          manifest.files.push({
            file,
            template: item.template,
            theme,
            language: lang,
            kind: item.illustration
              ? "illustration"
              : item.fixture
                ? "fixture"
                : "real",
            captureId: item.captureId || null,
            sha256: hash(bytes),
            bytes: bytes.length,
            cssWidth: inspected.width,
            cssHeight: inspected.height,
            ...inspected,
          });
          await page.close();
        }
  } finally {
    await browser.close();
  }
  await write(path.join(out, "art-manifest.json"), manifest);
  // Store every visual input beside the spec so regeneration survives cache deletion.
  const portable = structuredClone(cfg);
  for (const { item, capture } of prepared) {
    if (capture?.kind === "agent-run")
      for (const source of [
        ...(capture.usedFiles || []),
        ...(capture.response ? [capture.response] : []),
        ...(capture.artifacts || []),
        ...(capture.measurements?.source ? [capture.measurements.source] : []),
      ]) {
        const from = path.resolve(base, source.file),
          to = path.resolve(out, source.file);
        if (from !== to) {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(from, to);
        }
      }
    if (capture)
      await write(
        path.join(out, "captures", item.captureId + ".json"),
        capture,
      );
  }
  if (spec !== path.join(out, "art.json"))
    for (const item of portable.images) {
      if (item.screens)
        for (let i = 0; i < item.screens.length; i++) {
          const original = item.screens[i];
          const transfer = async (input) => {
            const source = path.resolve(base, input),
              relative = "screens/" + path.basename(input);
            await fs.mkdir(path.join(out, "screens"), { recursive: true });
            if (source !== path.join(out, relative))
              await fs.copyFile(source, path.join(out, relative));
            return relative;
          };
          item.screens[i] =
            typeof original === "string"
              ? await transfer(original)
              : Object.fromEntries(
                  await Promise.all(
                    Object.entries(original).map(async ([k, v]) => [
                      k,
                      await transfer(v),
                    ]),
                  ),
                );
        }
    }
  await write(path.join(out, "art.json"), portable);
  return manifest;
}
