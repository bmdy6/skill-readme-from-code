import { prepareLink, linkHTML, connectLinks } from "./art-link.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { read, json, write, hash, escape } from "./io.mjs";
const templateDir = fileURLToPath(
  new URL("../../templates/art/", import.meta.url),
);
const names = [
  "hero-link",
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
      balance: [],
      links: [],
    };
    const contentRects = [];
    let minMainFontSize = Infinity;
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
    const outside = (content, container) =>
      content.right > container.right + 1 ||
      content.left < container.left - 1 ||
      content.bottom > container.bottom + 1 ||
      content.top < container.top - 1;
    for (const e of frame.querySelectorAll("*")) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      // scrollHeight/clientHeight round independently and can compound a
      // subpixel text overshoot into a false 2px overflow on an ancestor.
      // Measure direct content in fractional CSS pixels instead. Descendants
      // are checked in their own turn, including text in fixed-height boxes.
      const cs = getComputedStyle(e);
      const box = {
        left: r.left + parseFloat(cs.borderLeftWidth),
        top: r.top + parseFloat(cs.borderTopWidth),
        right: r.right - parseFloat(cs.borderRightWidth),
        bottom: r.bottom - parseFloat(cs.borderBottomWidth),
      };
      const rects = [...e.children].flatMap((child) => [
        ...child.getClientRects(),
      ]);
      for (const node of e.childNodes)
        if (node.nodeType === 3 && node.textContent.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          // A text rect spans the font's ascent+descent, which can exceed the
          // line box (fallback CJK fonts). Compare its line-box part vertically.
          const lineHeight = parseFloat(cs.lineHeight);
          for (const t of range.getClientRects()) {
            const trim =
              lineHeight > 0 && t.height > lineHeight
                ? (t.height - lineHeight) / 2
                : 0;
            rects.push({
              left: t.left,
              right: t.right,
              top: t.top + trim,
              bottom: t.bottom - trim,
            });
          }
        }
      if (outside(r, bounds) || rects.some((content) => outside(content, box)))
        problems.overflow.push(e.tagName + "." + e.className);
      if (
        ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      )
        continue;
      if (parseFloat(cs.fontSize) < 13) problems.fontSize.push(e.textContent);
      if (
        !e.closest(
          ".head,.eyebrow,.caption,.illustration,.number,[data-label]",
        ) &&
        parseFloat(cs.fontSize) < 16
      )
        problems.mainText.push(e.textContent.slice(0, 80));
      // Actual text-bearing element boxes, excluding container-only cards.
      // Union later prevents nested inline text being counted twice.
      contentRects.push({
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      });
      if (
        !e.closest(".head,.eyebrow,.caption,.illustration,.number,[data-label]")
      )
        minMainFontSize = Math.min(minMainFontSize, parseFloat(cs.fontSize));
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
    const contentBounds = contentRects.length
      ? {
          left: Math.min(...contentRects.map((r) => r.left)),
          top: Math.min(...contentRects.map((r) => r.top)),
          right: Math.max(...contentRects.map((r) => r.right)),
          bottom: Math.max(...contentRects.map((r) => r.bottom)),
        }
      : null;
    // Sweep the rectangles to measure their union, never a bounding envelope.
    const area = (rects, left, right) => {
      const rs = rects
        .map((r) => ({
          left: Math.max(left, r.left),
          right: Math.min(right, r.right),
          top: Math.max(bounds.top, r.top),
          bottom: Math.min(bounds.bottom, r.bottom),
        }))
        .filter((r) => r.right > r.left && r.bottom > r.top);
      const xs = [...new Set(rs.flatMap((r) => [r.left, r.right]))].sort(
        (a, b) => a - b,
      );
      let sum = 0;
      for (let i = 1; i < xs.length; i++) {
        const ys = rs
          .filter((r) => r.left < xs[i] && r.right > xs[i - 1])
          .map((r) => [r.top, r.bottom])
          .sort((a, b) => a[0] - b[0]);
        let length = 0,
          end = -Infinity;
        for (const [top, bottom] of ys) {
          length += Math.max(0, bottom - Math.max(top, end));
          end = Math.max(end, bottom);
        }
        sum += (xs[i] - xs[i - 1]) * length;
      }
      return sum;
    };
    const contentArea = area(contentRects, bounds.left, bounds.right);
    const contentRatio = contentArea / (bounds.width * bounds.height);
    if (contentRatio < 0.6)
      problems.density.push(
        `Actual content occupies ${(100 * contentRatio).toFixed(1)}%; minimum 60%`,
      );
    const mid = (bounds.left + bounds.right) / 2;
    const halves = [
      area(contentRects, bounds.left, mid),
      area(contentRects, mid, bounds.right),
    ];
    const balanceRatio = Math.max(...halves)
      ? Math.min(...halves) / Math.max(...halves)
      : 0;
    if (balanceRatio < 1 / 3)
      problems.balance.push(
        `Left/right content ratio ${balanceRatio.toFixed(3)}; minimum 1:3`,
      );
    const linkRoot = frame.querySelector(".link-panels");
    let endpoints = [];
    if (linkRoot) {
      endpoints = JSON.parse(linkRoot.dataset.endpoints || "[]");
      const origin = linkRoot.getBoundingClientRect(),
        output = linkRoot
          .querySelector(".output-panel")
          .getBoundingClientRect(),
        source = linkRoot
          .querySelector(".source-panel")
          .getBoundingClientRect();
      const inside = (x, y, r) =>
        x >= r.left - 1 &&
        x <= r.right + 1 &&
        y >= r.top - 1 &&
        y <= r.bottom + 1;
      if (!endpoints.length) problems.links.push("Missing link endpoints");
      for (const p of endpoints)
        if (
          !inside(origin.left + p.x1, origin.top + p.y1, output) ||
          !inside(origin.left + p.x2, origin.top + p.y2, source)
        )
          problems.links.push(`Endpoint outside panel: ${p.index}`);
      if (
        !linkRoot.querySelector("svg path:last-child") ||
        Number(linkRoot.dataset.focus) < 0
      )
        problems.links.push("Focused connector missing");
    }
    return {
      contentBounds,
      contentRatio,
      contentArea,
      balanceRatio,
      minMainFontSize: Number.isFinite(minMainFontSize)
        ? minMainFontSize
        : null,
      endpoints,
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
    if (capture?.inputFile) {
      const p = path.resolve(base, capture.inputFile.file);
      const real = await fs.realpath(p),
        realBase = await fs.realpath(base);
      if (!real.startsWith(realBase + path.sep))
        throw Error("Capture input escapes art directory");
      const bytes = await fs.readFile(real);
      if (
        hash(bytes) !== capture.inputFile.sha256 ||
        bytes.toString("utf8") !== capture.input
      )
        throw Error("Capture input hash/content mismatch");
    }
    const link =
      item.template === "hero-link"
        ? await prepareLink(item, capture, base, cache)
        : null;
    prepared.push({ item, capture, link });
  }
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const manifest = { schemaVersion: 1, accent, files: [] };
  try {
    for (const { item, capture, link } of prepared)
      for (const lang of ["en", "zh-CN"])
        for (const theme of ["light", "dark"]) {
          const zh = lang === "zh-CN",
            text = (v, f) => escape(pick(v, lang, f));
          const values = {
            title:
              item.template === "hero-link" ? "" : text(item.title, "title"),
            subtitle:
              item.template === "hero-link"
                ? ""
                : text(item.subtitle, "subtitle"),
            link: link ? linkHTML(link) : "",
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
            resultLabel: item.resultLabel
              ? text(item.resultLabel, "resultLabel")
              : zh
                ? "输出"
                : "Output",
            outputClass:
              capture?.kind === "agent-run"
                ? "prose-output"
                : capture
                  ? "terminal"
                  : "illustrated-result",
            terminalLabel: zh ? "终端记录" : "terminal capture",
            inputLabel: zh ? "输入" : "Input",
            command: escape(capture?.command || ""),
            codeInput: escape(
              capture?.inputFile ? capture.input : capture?.command || "",
            ),
            output: escape(
              capture
                ? stripANSI(
                    capture.stdout +
                      (capture.stderr ? "\n" + capture.stderr : ""),
                  ).trim()
                : ["strip-3", "hero-screens", "hero-link"].includes(
                      item.template,
                    )
                  ? ""
                  : pick(item.result, lang, "result"),
            ),
            scoreLabel:
              capture?.measurements?.score !== undefined
                ? capture.measurements.before?.score !== undefined
                  ? `${zh ? "原稿" : "Voice match"} ${Number(capture.measurements.before.score)} → ${zh ? "润色后 " : ""}${Number(capture.measurements.score)}`
                  : `${zh ? "风格检查" : "Style check"} ${Number(capture.measurements.score)}/100`
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
            `<!doctype html><meta charset="utf-8"><style>${await read(path.join(templateDir, "base.css"))}:root{--accent:${accent}}</style><body class="${theme}"><main class="frame ${item.template === "social" ? "social" : item.template === "strip-3" ? "strip" : ""} ${item.template} ${item.compact ? "compact" : ""}">${content}</main></body>`,
          );
          await page.evaluate(() => document.fonts.ready);
          if (
            item.template !== "social" &&
            ["hero-terminal", "hero-code", "hero-prompt"].includes(
              item.template,
            ) &&
            !capture?.inputFile &&
            capture?.kind !== "agent-run" &&
            (capture?.stdout || "").split("\n").filter((l) => l.trim()).length <
              4
          )
            await page
              .locator(".frame")
              .evaluate((e) => (e.style.width = "640px"));
          // Measure after fonts and the final canvas width are ready. Preserve the
          // normal wrapping; only shrink headings that still overflow their box.
          await page.evaluate(() => {
            for (const title of document.querySelectorAll(
              ".frame h1,.frame h2",
            )) {
              const minimum = 16;
              let size = parseFloat(getComputedStyle(title).fontSize);
              while (
                size > minimum &&
                (title.scrollWidth > title.clientWidth + 1 ||
                  title.scrollHeight > title.clientHeight + 1)
              ) {
                size = Math.max(minimum, size - 1);
                title.style.fontSize = `${size}px`;
              }
            }
          });
          if (link) await connectLinks(page, link.focus);
          if (item.template === "social")
            await page.evaluate(() => {
              const frame = document.querySelector(".frame"),
                card = frame.querySelector(".card");
              // Fit the complete stack, including CJK wrapping, before measuring.
              for (
                let n = 0;
                n < 200 &&
                card.getBoundingClientRect().bottom >
                  frame.getBoundingClientRect().bottom - 40;
                n++
              ) {
                let changed = false;
                for (const selector of ["h1,.sub", "pre"]) {
                  for (const e of frame.querySelectorAll(selector)) {
                    const current = parseFloat(getComputedStyle(e).fontSize),
                      min = e.matches("pre") ? 26 : 16;
                    if (current > min) {
                      e.style.fontSize = current - 1 + "px";
                      changed = true;
                    }
                  }
                  if (changed) break;
                }
                if (!changed) break;
              }
            });
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
            inputFile: capture?.inputFile || null,
            labels: {
              result: item.resultLabel
                ? pick(item.resultLabel, lang, "resultLabel")
                : zh
                  ? "输出"
                  : "Output",
            },
            ...(link ? { link: { ...link, visible: undefined } } : {}),
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
  for (const { item, capture, link } of prepared) {
    if (link)
      for (const input of link.inputs) {
        const from = path.resolve(base, input.file),
          to = path.resolve(out, input.file);
        if (from !== to) {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(from, to);
        }
      }
    for (const output of capture?.outputs || []) {
      const from = await fs.realpath(path.resolve(base, output.file)),
        realBase = await fs.realpath(base);
      if (!from.startsWith(realBase + path.sep))
        throw Error("Capture output escapes art directory");
      const bytes = await fs.readFile(from);
      if (hash(bytes) !== output.sha256)
        throw Error("Capture output hash mismatch: " + output.file);
      const to = path.resolve(out, output.file);
      if (from !== to) {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.writeFile(to, bytes);
      }
    }
    if (capture?.inputFile) {
      const from = path.resolve(base, capture.inputFile.file),
        to = path.resolve(out, capture.inputFile.file);
      if (from !== to) {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
      }
    }
    if (capture?.kind === "agent-run")
      for (const source of [
        ...(capture.usedFiles || []),
        ...(capture.response ? [capture.response] : []),
        ...(capture.artifacts || []),
        ...(capture.measurements?.source ? [capture.measurements.source] : []),
        ...(capture.measurements?.before?.source
          ? [capture.measurements.before.source]
          : []),
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
