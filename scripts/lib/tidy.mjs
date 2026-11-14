import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import { freezeBaseline, git } from "./baseline.mjs";
import { json, read, write } from "./io.mjs";
import { headings, links, shellBlocks } from "./markdown.mjs";
import { editorialChecks } from "./verify.mjs";
import { firstScreen, markdownHTML } from "./screen.mjs";

// Discover every root language README, without changing illustrate's document set.
async function documents(repo) {
  const names = (await fs.readdir(repo))
    .filter((f) => /^README(?:[.\w-]*)\.md$/.test(f))
    .sort();
  return Promise.all(
    names.map(async (file) => ({
      file,
      text: await read(path.join(repo, file)),
    })),
  );
}
export const tidyBaseline = (o) =>
  freezeBaseline(o, path.join(o.work, "tidy-baseline.json"), documents);
const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
const counts = (values) => {
  const out = new Map();
  for (const v of values) out.set(v, (out.get(v) || 0) + 1);
  return out;
};
function missing(before, after) {
  const available = counts(after),
    out = [];
  for (const s of before) {
    if (available.get(s)) available.set(s, available.get(s) - 1);
    else out.push(s);
  }
  return out;
}
function fencedBlocks(md) {
  const out = [];
  marked.walkTokens(marked.lexer(md), (t) => {
    if (t.type === "code" && /^\s*(?:`{3,}|~{3,})/.test(t.raw))
      out.push(JSON.stringify({ language: t.lang || "", text: t.text }));
  });
  return out.sort(); // Whole sections may move; code content and multiplicity may not.
}
const h2 = (text) =>
  headings(text)
    .filter((h) => h.depth === 2)
    .map((h) => h.text);

export async function verifyTidy(o) {
  const baseline = await json(path.join(o.work, "tidy-baseline.json"));
  if (
    !baseline?.readmes?.length ||
    !/^[a-f0-9]{40}$/.test(baseline.commit || "")
  )
    throw Error(
      "Run tidy baseline before editing (commit/blob references required)",
    );
  const old = [];
  for (const d of baseline.readmes) {
    if (
      !/^README(?:[.\w-]*)\.md$/.test(d.file) ||
      !/^[a-f0-9]{40}$/.test(d.blob || "") ||
      git(o.repo, ["rev-parse", `${baseline.commit}:${d.file}`]).trim() !==
        d.blob
    )
      throw Error("Invalid baseline blob reference");
    old.push({
      ...d,
      text: git(o.repo, ["show", `${baseline.commit}:${d.file}`]),
    });
  }
  const spec = await json(path.join(o.work, "tidy.json"));
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    throw Error("tidy.json must be an object ({} is valid)");
  const docs = await documents(o.repo),
    issues = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`T${i + 1}`, []]),
    ),
    warnings = { T7: [], T8: [] },
    screens = [];
  const groups = {
    renamedHeadings: "T1",
    removed: "T2",
    rewritten: "T2",
    added: "T3",
    removedLinks: "T5",
  };
  for (const key of Object.keys(spec))
    if (![...Object.keys(groups), "installs"].includes(key))
      issues.T3.push(`Unknown manifest field: ${key}`);
  const entries = {};
  for (const [key, id] of Object.entries(groups)) {
    entries[key] = [];
    if (spec[key] !== undefined && !Array.isArray(spec[key])) {
      issues[id].push(`${key} must be an array`);
      continue;
    }
    for (const e of spec[key] || []) {
      if (
        !e ||
        typeof e.reason !== "string" ||
        !e.reason.trim() ||
        !old.some((d) => d.file === e.readme)
      ) {
        issues[id].push(`${key}: known readme and nonempty reason required`);
        continue;
      }
      const before = old.find((d) => d.file === e.readme).text,
        after = docs.find((d) => d.file === e.readme)?.text || "";
      let valid = false;
      if (key === "renamedHeadings")
        valid =
          typeof e.before === "string" &&
          typeof e.after === "string" &&
          h2(before).includes(e.before) &&
          h2(after).includes(e.after);
      if (key === "removed" || key === "rewritten")
        valid =
          typeof e.before === "string" &&
          !!e.before.trim() &&
          before.includes(e.before) &&
          typeof e.after === "string" &&
          (key !== "removed" || e.after === "") &&
          (!e.after ||
            after.includes(e.after) ||
            missing(lines(e.after), lines(after)).length === 0);
      if (key === "removedLinks")
        valid =
          typeof e.url === "string" &&
          links(before).includes(e.url) &&
          !links(after).includes(e.url);
      if (key === "added") {
        valid =
          typeof e.text === "string" &&
          !!e.text.trim() &&
          after.includes(e.text) &&
          !/[\r\n]/.test(e.text);
        if (e.kind === "heading") valid &&= /^## (?!#).+/.test(e.text);
        else if (e.kind === "navigation")
          valid &&=
            /\[[^\]]+\]\([^)]+\)/.test(e.text) &&
            !e.text
              .replace(/\[[^\]]+\]\([^)]+\)/g, "")
              .replace(/[\s·|/—-]/g, "");
        else if (e.kind === "details")
          valid &&=
            /^(?:<details>\s*(?:<summary>[^<>]+<\/summary>)?|<summary>[^<>]+<\/summary>|<\/details>)$/.test(
              e.text,
            );
        else if (e.kind === "oneLiner") {
          const prefix = after.slice(0, after.indexOf(e.text));
          valid &&= /^#\s|<h1\b/im.test(prefix) && !/^##\s/m.test(prefix);
        } else valid = false;
      }
      if (!valid) issues[id].push(`${e.readme}: invalid ${key} registration`);
      else entries[key].push(e);
    }
  }
  for (const d of docs)
    for (const kind of ["oneLiner", "navigation"])
      if (
        entries.added.filter((e) => e.readme === d.file && e.kind === kind)
          .length > 1
      )
        issues.T3.push(`${d.file}: at most one added ${kind} line`);
  if (
    JSON.stringify(old.map((d) => d.file).sort()) !==
    JSON.stringify(docs.map((d) => d.file).sort())
  )
    issues.T2.push("README set changed");
  for (const b of old) {
    const d = docs.find((d) => d.file === b.file);
    if (!d) continue;
    const local = (key) => entries[key].filter((e) => e.readme === d.file);
    const rename = local("renamedHeadings");
    const changes = [...local("removed"), ...local("rewritten")];
    let expected = b.text;
    for (const e of changes) {
      if (!expected.includes(e.before))
        issues.T2.push(`${d.file}: overlapping/repeated registration`);
      else expected = expected.replace(e.before, e.after);
    }
    for (const e of rename)
      expected = expected.replace(
        new RegExp(
          `^## ${e.before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "m",
        ),
        () => `## ${e.after}`,
      );
    for (const title of missing(h2(b.text), h2(d.text)))
      if (
        !rename.some((e) => e.before === title) &&
        !local("removed").some((e) => lines(e.before).includes(`## ${title}`))
      )
        issues.T1.push(`${d.file}: missing H2 ${title}`);
    for (const line of missing(lines(expected), lines(d.text)))
      issues.T2.push(`${d.file}: unregistered removal: ${line}`);
    for (const line of missing(lines(d.text), [
      ...lines(expected),
      ...local("added").map((e) => e.text.trim()),
    ]))
      issues.T3.push(`${d.file}: unregistered addition: ${line}`);
    if (
      JSON.stringify(fencedBlocks(b.text)) !==
      JSON.stringify(fencedBlocks(d.text))
    )
      issues.T4.push(`${d.file}: fenced code content or count changed`);
    const waivedLinks = [
      ...local("removedLinks").map((e) => e.url),
      ...changes
        .flatMap((e) => links(e.before))
        .filter((url) => !changes.some((e) => links(e.after).includes(url))),
    ];
    for (const url of links(b.text))
      if (!links(d.text).includes(url) && !waivedLinks.includes(url))
        issues.T5.push(`${d.file}: missing link/image ${url}`);
    const { html } = await markdownHTML(d.text, { local: true });
    const anchors = [...html.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    for (const e of local("added").filter((e) => e.kind === "navigation"))
      for (const url of links(e.text)) {
        if (!url.startsWith("#")) continue;
        let anchor;
        try {
          anchor = decodeURIComponent(url.slice(1));
        } catch {
          anchor = null;
        }
        if (!anchors.includes(anchor))
          issues.T6.push(`${d.file}: unresolved navigation ${url}`);
      }
    issues.T7.push(...editorialChecks([d]));
    const install = spec.installs?.[d.file] || {
      block: shellBlocks(b.text)[0]?.code,
    };
    if (!install.block && !install.command && !install.url) {
      warnings.T8.push(
        `${d.file}: no installation block identified; not measured`,
      );
      continue;
    }
    const common = {
      repo: o.repo,
      readme: d.file,
      install,
      local: !!o.local,
      offline: !!o.offline,
    };
    const before = await firstScreen({
      ...common,
      markdown: b.text,
      work: path.join(o.work, "baseline-screens", d.file),
    });
    const after = await firstScreen({
      ...common,
      markdown: d.text,
      work: path.join(o.work, "screens", d.file),
    });
    screens.push({ readme: d.file, before, after });
    for (const viewport of ["desktop", "desktop-dark"]) {
      const a = before.viewports[viewport],
        z = after.viewports[viewport];
      if (!a.items.install || !z.items.install)
        issues.T8.push(`${d.file} ${viewport}: installation block missing`);
      else if (a.checks.install && !z.checks.install)
        issues.T8.push(
          `${d.file} ${viewport}: installation regressed below fold`,
        );
      else if (!a.checks.install)
        warnings.T8.push(
          `${d.file} ${viewport}: baseline installation already below fold`,
        );
    }
  }
  const checks = Object.entries(issues).map(([id, items]) => ({
    id,
    status: items.length ? "fail" : "pass",
    issues: items,
    ...(warnings[id] ? { warnings: warnings[id] } : {}),
    ...(id === "T8" ? { screens } : {}),
  }));
  const result = {
    mode: "tidy",
    ok: checks.every((c) => c.status === "pass"),
    checks,
  };
  await write(path.join(o.work, "tidy-report.json"), result);
  await write(
    path.join(o.work, "tidy-report.md"),
    `# Tidy report\n\nConclusion: ${result.ok ? "PASS" : "FAIL"} (${checks.filter((c) => c.status === "pass").length}/8 checks passed).\n\n` +
      checks
        .map(
          (c) =>
            `- ${c.id}: ${c.status.toUpperCase()}${c.issues.length ? " — " + c.issues.join("; ") : ""}\n` +
            (c.warnings || []).map((w) => `  - Warning: ${w}\n`).join(""),
        )
        .join(""),
  );
  return result;
}
