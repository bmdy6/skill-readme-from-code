import fs from "node:fs/promises";
import path from "node:path";
import { hash, escape } from "./io.mjs";

export function at(object, selector) {
  if (selector === "" || selector === undefined) return object;
  // Dotted paths or RFC6901 pointers; literal token keys containing dots use pointers.
  const keys = selector.startsWith("/")
    ? selector
        .slice(1)
        .split("/")
        .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"))
    : selector.split(".");
  return keys.reduce(
    (v, k) => (v && Object.hasOwn(v, k) ? v[k] : undefined),
    object,
  );
}
async function localFile(base, file) {
  if (typeof file !== "string" || path.isAbsolute(file))
    throw Error("hero-link requires relative local files");
  const full = path.resolve(base, file),
    real = await fs.realpath(full);
  if (!real.startsWith((await fs.realpath(base)) + path.sep))
    throw Error("hero-link input escapes its directory");
  return real;
}
const scalar = (value, label) => {
  if (
    !["string", "number", "boolean"].includes(typeof value) ||
    !String(value).trim()
  )
    throw Error(`Missing hero-link ${label} scalar`);
  return String(value);
};
export async function prepareLink(item, capture, base, cache) {
  const link = item.link;
  if (
    !capture ||
    !link ||
    !Array.isArray(link.items) ||
    !link.items.length ||
    link.items.length > 6
  )
    throw Error("hero-link requires capture and 1–6 field-selected items");
  if (!Number.isInteger(link.focus) || !link.items[link.focus])
    throw Error("Invalid hero-link focus");
  if (
    capture.exitCode !== undefined &&
    (capture.exitCode !== 0 || capture.timedOut)
  )
    throw Error("hero-link capture failed");
  const recorded = [...(capture.usedFiles || []), ...(capture.outputs || [])];
  const output = recorded.find((f) => f.file === link.output);
  if (!output?.sha256)
    throw Error("hero-link output must be a hashed capture output or usedFile");
  const outputFile = await localFile(base, link.output),
    outputBytes = await fs.readFile(outputFile);
  if (hash(outputBytes) !== output.sha256)
    throw Error("hero-link output hash mismatch");
  const entries = at(JSON.parse(outputBytes), link.outputPath);
  if (!Array.isArray(entries) || !entries.length)
    throw Error("hero-link outputPath must resolve to an array");
  const sourceFile = await localFile(base, link.source),
    sourceBytes = await fs.readFile(sourceFile),
    lines = sourceBytes.toString("utf8").split(/\r?\n/);
  const inputs = [
    { file: link.output, sha256: hash(outputBytes) },
    { file: link.source, sha256: hash(sourceBytes) },
  ];
  const items = [];
  for (const fields of link.items) {
    if (!Number.isInteger(fields.index) || !entries[fields.index])
      throw Error("Invalid hero-link item index");
    const entry = entries[fields.index];
    let provenance = entry;
    if (fields.source) {
      const input = recorded.find((f) => f.file === fields.source.file);
      if (!input?.sha256)
        throw Error("hero-link provenance must be a hashed capture file");
      const bytes = await fs.readFile(await localFile(base, input.file));
      if (hash(bytes) !== input.sha256)
        throw Error("hero-link provenance hash mismatch");
      provenance = at(JSON.parse(bytes), fields.source.path);
      inputs.push({ ...input });
    }
    const name = scalar(at(entry, fields.name), "name"),
      value = scalar(at(entry, fields.value), "value");
    const line = at(provenance, fields.line);
    if (!Number.isInteger(line) || line < 1 || line > lines.length)
      throw Error("hero-link source line out of range");
    const evidence = fields.evidence
      ? scalar(at(provenance, fields.evidence), "evidence")
      : value;
    if (!lines[line - 1].includes(evidence))
      throw Error(`hero-link source mismatch at ${link.source}:${line}`);
    items.push({ index: fields.index, name, value, line, evidence });
  }
  const status = link.status;
  if (
    !status ||
    !["capture", "verify"].includes(status.from) ||
    typeof status.path !== "string"
  )
    throw Error("hero-link status must select a real capture or verify field");
  let statusData = capture;
  if (status.from === "verify") {
    const file = status.file || "verify.json";
    const bytes = await fs.readFile(await localFile(base, file));
    statusData = JSON.parse(bytes);
    inputs.push({ file, sha256: hash(bytes) });
  }
  const statusValue = scalar(at(statusData, status.path), "status");
  const wanted = new Set();
  for (const { line } of items)
    for (
      let n = Math.max(1, line - 1);
      n <= Math.min(lines.length, line + 1);
      n++
    )
      wanted.add(n);
  const visible = [];
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (visible.length && n > visible.at(-1).line + 1)
      visible.push({ line: n - 1, gap: true });
    visible.push({
      line: n,
      text: lines[n - 1],
      highlight: items.some((i) => i.line === n),
    });
  }
  // Preserve exact substrings, with explicit ellipses for omitted source text.
  // Multiple citations on one line retain all evidence substrings.
  const excerpts = visible.map((row) => {
    if (row.gap) return row;
    const code = row.text.trim(),
      needles = items.filter((i) => i.line === row.line).map((i) => i.evidence);
    if (code.length <= 30) return { ...row, text: code };
    const intervals = needles.length
      ? needles
          .map((needle) => {
            const start = code.indexOf(needle);
            const declaration =
              Math.max(
                code.lastIndexOf(";", start),
                code.lastIndexOf("{", start),
              ) + 1;
            return [declaration, Math.min(code.length, start + needle.length)];
          })
          .sort((a, b) => a[0] - b[0])
      : [[0, 28]];
    const merged = [];
    for (const [start, end] of intervals) {
      if (merged.length && start <= merged.at(-1)[1] + 3)
        merged.at(-1)[1] = Math.max(end, merged.at(-1)[1]);
      else merged.push([start, end]);
    }
    const text =
      (merged[0][0] > 0 ? "…" : "") +
      merged.map(([start, end]) => code.slice(start, end)).join("…") +
      (merged.at(-1)[1] < code.length ? "…" : "");
    return { ...row, text };
  });
  return {
    output,
    excerpts,
    source: { file: link.source, sha256: hash(sourceBytes) },
    inputs: [...new Map(inputs.map((i) => [i.file, i])).values()],
    items,
    visible,
    total: entries.length,
    focus: link.focus,
    status: { ...status, value: statusValue },
  };
}
export function linkHTML(data) {
  const badge = (i) => `${path.basename(data.source.file)}:${i.line}`;
  const rows = data.items
    .map(
      (i, index) =>
        `<div class="link-item ${index === data.focus ? "focus" : ""}" data-item="${index}" data-line="${i.line}">${escape(i.name)}<span class="token-value">${/^#[0-9a-f]{3,8}$/i.test(i.value) ? `<i class="swatch" style="background:${i.value}"></i>` : ""}${escape(i.value)}</span><span class="source-badge" data-label>${escape(badge(i))}</span></div>`,
    )
    .join("");
  const code = data.excerpts
    .map((i) =>
      i.gap
        ? '<div class="source-gap" data-label>⋯</div>'
        : `<div class="source-line ${i.line === data.items[data.focus].line ? "cited focused-source" : i.highlight ? "cited" : ""}" data-line="${i.line}"><span class="line-number" data-label>${i.line}</span>${escape(i.text)}</div>`,
    )
    .join("");
  return `<div class="link-panels"><section class="card output-panel"><div class="head">${escape(path.basename(data.output.file))}<span>${data.items.length} of ${data.total}</span></div><div class="token-rows">${rows}</div></section><section class="card source-panel"><div class="head">${escape(path.basename(data.source.file))}<span>source</span></div><div class="source-rows">${code}</div></section><svg class="link-lines" aria-hidden="true"></svg></div><p class="link-status" data-label>${escape(data.status.path)}: ${escape(data.status.value)}</p>`;
}
// Run after layout/fonts. Sort by endpoints; focus is painted last with a halo.
export async function connectLinks(page, focus) {
  return page.evaluate((focus) => {
    const root = document.querySelector(".link-panels"),
      svg = root.querySelector("svg"),
      b = root.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${b.width} ${b.height}`);
    const endpoints = [...root.querySelectorAll(".link-item")]
      .map((row, index) => {
        const badge = row
          .querySelector(".source-badge")
          .getBoundingClientRect();
        const line = root.querySelector(
          `.source-line[data-line="${row.dataset.line}"]`,
        );
        const target = line.getBoundingClientRect();
        return {
          index,
          x1: badge.right - b.left - 2,
          y1: (badge.top + badge.bottom) / 2 - b.top,
          x2: target.left - b.left + 2,
          y2: (target.top + target.bottom) / 2 - b.top,
        };
      })
      .sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
    const ns = "http://www.w3.org/2000/svg";
    const paint = (p, halo = false) => {
      const e = document.createElementNS(ns, "path");
      const mid = (p.x1 + p.x2) / 2;
      e.setAttribute(
        "d",
        `M${p.x1},${p.y1} C${mid},${p.y1} ${mid},${p.y2} ${p.x2},${p.y2}`,
      );
      e.setAttribute("fill", "none");
      e.setAttribute(
        "stroke",
        halo
          ? "var(--bg)"
          : p.index === focus
            ? "var(--accent)"
            : "var(--accent)",
      );
      e.setAttribute(
        "stroke-width",
        halo ? "7" : p.index === focus ? "2.5" : "1.2",
      );
      if (p.index !== focus) {
        e.setAttribute("stroke-dasharray", "4 5");
        e.setAttribute("opacity", ".45");
      }
      svg.append(e);
    };
    endpoints.filter((p) => p.index !== focus).forEach((p) => paint(p));
    const chosen = endpoints.find((p) => p.index === focus);
    paint(chosen, true);
    paint(chosen);
    root.dataset.focus = String(focus);
    root.dataset.endpoints = JSON.stringify(endpoints);
    return endpoints;
  }, focus);
}
