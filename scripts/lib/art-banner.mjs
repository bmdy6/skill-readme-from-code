import fs from "node:fs/promises";
import path from "node:path";
import { escape, read, readmeDocuments, write } from "./io.mjs";

function field(data, key) {
  if (typeof key !== "string" || !/^[\w-]+(?:\.[\w-]+)*$/.test(key))
    throw Error("Banner fields must reference captured JSON paths");
  for (const part of key.split(".")) {
    if (!data || !Object.hasOwn(data, part)) throw Error("Missing banner capture field: " + key);
    data = data[part];
  }
  if (!["string", "number", "boolean"].includes(typeof data))
    throw Error("Banner fields must be scalar: " + key);
  return data;
}

async function outputPath(file) {
  try { return await fs.realpath(file); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    return path.join(await outputPath(path.dirname(file)), path.basename(file));
  }
}

export async function prepareBanner(item, capture, repo, out) {
  if (!capture || capture.exitCode !== 0 || capture.timedOut ||
      typeof capture.command !== "string" || !capture.command.trim())
    throw Error("showcase-banner requires a successful capture");
  const data = JSON.parse(capture.stdout);
  if (!Array.isArray(item.metrics) || !item.metrics.length || item.metrics.length > 4)
    throw Error("Banner needs one to four captured metrics");
  const metrics = item.metrics.map(metric => {
    const value = field(data, metric.field);
    if (typeof value !== "number" || !Number.isFinite(value) || metric.value !== undefined)
      throw Error("Banner metrics must reference captured numbers");
    return { field: metric.field, value, label: metric.label };
  });
  if (!Array.isArray(item.outputFields) || !item.outputFields.length || item.outputFields.length > 8)
    throw Error("Banner needs one to eight outputFields");
  const output = JSON.stringify(Object.fromEntries(item.outputFields.map(key => [key, field(data, key)])), null, 2);
  const readmes = [];
  if (item.readmes !== undefined) {
    if (!repo || !Object.keys(item.readmes).length) throw Error("Banner readmes require --repo and a filename/language map");
    const realRepo = await fs.realpath(repo), realOut = await outputPath(path.resolve(out));
    if (!realOut.startsWith(realRepo + path.sep)) throw Error("Banner output must be inside the repository");
    for (const document of await readmeDocuments(repo, { readmes: item.readmes })) {
      if (!Object.hasOwn(item.readmes, document.file)) continue;
      const file = await fs.realpath(path.join(repo, document.file));
      if (!file.startsWith(realRepo + path.sep)) throw Error("Banner README escapes repository");
      const start = `<!-- readme-from-code:banner:${item.id}:start -->`;
      const end = `<!-- readme-from-code:banner:${item.id}:end -->`;
      const count = marker => document.text.split(marker).length - 1;
      if (count(start) !== count(end) || count(start) > 1 ||
          (count(start) && document.text.indexOf(start) > document.text.indexOf(end)))
        throw Error("Invalid banner README markers");
      readmes.push({ ...document, path: file, start, end });
    }
  }
  return { metrics, output, readmes };
}

export function bannerValues(item, banner, text) {
  return {
    eyebrow: text(item.eyebrow, "eyebrow"),
    description: text(item.description, "description"),
    integrations: (item.integrations || []).map(s => `<span>${escape(s)}</span>`).join(""),
    bannerOutput: escape(banner.output),
    metrics: banner.metrics.map(metric => `<div class="banner-metric"><strong>${metric.value}</strong><span data-label>${text(metric.label, "metric.label")}</span></div>`).join(""),
  };
}

export async function writeBannerReadmes(prepared, manifest, out, pick) {
  if (manifest.files.some(f => Object.values(f.checks).some(s => s !== "pass"))) return;
  const updates = [];
  const realOut = await fs.realpath(out);
  for (const { item, capture, banner } of prepared) {
    for (const document of banner?.readmes || []) {
      const { language, start, end } = document;
      const suffix = language === "zh-CN" ? ".zh-CN" : "";
      const image = theme => escape(path.relative(path.dirname(document.path), path.join(realOut, `${item.id}-${theme}${suffix}.png`)).split(path.sep).join("/"));
      const alt = escape(pick(item.title, language, "title") + " — " + pick(item.subtitle, language, "subtitle"));
      const caption = escape(pick(item.caption, language, "caption"));
      const block = `${start}\n<h1><picture>\n  <source media="(prefers-color-scheme: dark)" srcset="${image("dark")}">\n  <img src="${image("light")}" alt="${alt}" width="838">\n</picture></h1>\n<p><em>${caption} <code>${escape(capture.command)}</code></em></p>\n${end}`;
      const current = await read(document.path);
      if (current !== document.text) throw Error("README changed during art rendering: " + document.file);
      updates.push([document.path, current.includes(start)
        ? current.slice(0, current.indexOf(start)) + block + current.slice(current.indexOf(end) + end.length)
        : block + "\n\n" + current]);
    }
  }
  for (const [file, content] of updates) await write(file, content);
}
