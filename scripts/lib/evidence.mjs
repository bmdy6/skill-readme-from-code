import path from "node:path";
import fs from "node:fs/promises";
import { json, hash } from "./io.mjs";
const result = (id, issues) => ({
  id,
  status: issues.length ? "fail" : "pass",
  issues,
});
export async function heroRelevance(repo, brief, facts) {
  const issues = [],
    core = brief.coreAction;
  if (
    !core?.what ||
    !core.input ||
    !(core.command || core.agentStep) ||
    !core.output?.keywords?.length ||
    !core.factIds?.length
  )
    issues.push(
      "Missing sourced coreAction (what, input, command/agentStep, output keywords, factIds)",
    );
  if (
    facts &&
    core?.factIds?.some((id) => !facts.facts.some((f) => f.id === id))
  )
    issues.push("coreAction references unknown fact IDs");
  const base = path.join(repo, "docs/readme");
  const spec = await json(path.join(base, "art.json"));
  const hero = spec?.images?.find((i) => i.id === "hero");
  const capture =
    hero?.captureId &&
    (await json(path.join(base, "captures", hero.captureId + ".json")));
  if (!capture) issues.push("Hero requires a core capture");
  else {
    if (typeof capture.stdout !== "string" || !capture.stdout.trim())
      issues.push("Core capture has no output");
    if (capture.role !== "core") issues.push("Hero capture role must be core");
    const command = capture.command || "";
    if (
      /\b(?:skills\s+add|(?:npm|pnpm|yarn)\s+(?:ci|i\b|install|add)|(?:gh\s+repo|git)\s+clone|pip\s+install)\b/i.test(
        command,
      )
    )
      issues.push("Hero shows an installation command");
    if (/\b(?:test|lint|check|verify)(?:\b|[._-])/i.test(command))
      issues.push("Hero shows a check instead of the core action");
    if (
      /\bpreview\.mjs\b|\b(?:cat|head)\s+README/i.test(command) ||
      (hero.template !== "hero-screens" &&
        /^#{1,2}\s+.+/m.test(capture.stdout || ""))
    )
      issues.push("Hero shows README text rather than a core result");
    if (capture.kind === "agent-run") {
      if (
        !capture.input ||
        !capture.agentStep ||
        !capture.usedFiles?.length ||
        !capture.response?.file
      )
        issues.push(
          "Agent-run needs input, agentStep, usedFiles and an original response",
        );
      else {
        for (const used of [
          ...capture.usedFiles,
          capture.response,
          ...(capture.artifacts || []),
          ...(capture.measurements?.source
            ? [capture.measurements.source]
            : []),
        ]) {
          const p = path.resolve(base, used.file);
          if (!p.startsWith(path.resolve(base) + path.sep))
            issues.push("Agent-run source escapes its input directory");
          else
            try {
              if (hash(await fs.readFile(p)) !== used.sha256)
                issues.push(`Changed agent-run source: ${used.file}`);
            } catch {
              issues.push(`Missing agent-run source: ${used.file}`);
            }
        }
        if (capture.audits)
          for (const phase of ["before", "after"]) {
            const actual = await json(
              path.join(base, capture.audits[phase].file),
            );
            if (actual?.score !== capture.audits[phase].score)
              issues.push(
                `Displayed ${phase} audit score differs from actual audit`,
              );
          }
        if (capture.measurements?.source) {
          const score = await json(
            path.join(base, capture.measurements.source.file),
          );
          if (score?.score !== capture.measurements.score)
            issues.push("Displayed score differs from actual check output");
        }
        try {
          const raw = await json(path.join(base, capture.response.file));
          if (raw?.[capture.response.outputKey] !== capture.stdout)
            issues.push("Agent output differs from the original response");
        } catch {
          issues.push("Invalid original agent response");
        }
      }
    } else if (
      capture.exitCode !== undefined &&
      (capture.exitCode !== 0 || capture.timedOut)
    )
      issues.push("Core command did not complete successfully");
  }
  return result("V10", issues);
}

export async function retentionCheck(repo, opts = {}) {
  const baseline = await json(
    path.join(repo, "docs/readme/baseline.json"),
    opts.work ? await json(path.join(opts.work, "baseline.json")) : null,
  );
  if (!baseline)
    return {
      id: "V11",
      status: "skip",
      reason: "No pre-edit README snapshot supplied",
      issues: [],
    };
  const decisions = await json(path.join(repo, "docs/readme/retention.json"), {
    intentionalDeletions: [],
  });
  const { read } = await import("./io.mjs");
  const { headings, links } = await import("./markdown.mjs");
  const issues = [],
    preserved = [],
    deleted = [];
  const accounted = (id) => {
    const d = decisions.intentionalDeletions?.find(
      (d) => d.id === id && typeof d.reason === "string" && d.reason.trim(),
    );
    if (d) deleted.push(d);
    return !!d;
  };
  const literal = (text, value) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}_])${String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
      "iu",
    ).test(text);
  for (const old of baseline.readmes || []) {
    const md = await read(path.join(repo, old.file));
    const sources = [{ file: old.file, text: md }];
    for (const target of links(md)) {
      const rel = target.split("#")[0];
      if (!/^docs\/.*\.md$/i.test(rel)) continue;
      const full = path.resolve(repo, rel);
      if (!full.startsWith(path.resolve(repo) + path.sep)) continue;
      sources.push({ file: rel, text: await read(full) });
    }
    for (const title of old.headings || []) {
      const id = `heading:${old.file}:${title}`;
      const found = sources.find((s) =>
        headings(s.text).some((h) => h.depth === 2 && h.text === title),
      );
      if (found) preserved.push({ id, in: found.file });
      else if (!accounted(id))
        issues.push(`Unaccounted old H2: ${old.file}: ${title}`);
    }
    for (const fact of (baseline.integrations || []).filter(
      (f) => !f.readme || f.readme === old.file,
    )) {
      const found = sources.find((s) => literal(s.text, fact.value));
      if (found) preserved.push({ id: fact.id, in: found.file });
      else if (!accounted(fact.id))
        issues.push(`Unaccounted integration: ${fact.value}`);
    }
  }
  return { ...result("V11", issues), preserved, intentionalDeletions: deleted };
}
