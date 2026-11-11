import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
test("skill names every command, gates and hard delivery boundaries", async () => {
  const s = await fs.readFile("SKILL.md", "utf8");
  assert.ok(s.split("\n").length <= 262);
  for (const term of [
    "G1",
    "G2",
    "doctor",
    "scan",
    "audit",
    "capture",
    "art",
    "verify",
    "stranger",
    "storefront",
    "report",
    "not-run",
    "decidedBy",
    "Never merge",
  ])
    assert.ok(s.includes(term), term);
});
test("each project skeleton puts Quick start immediately after hero", async () => {
  for (const type of ["cli", "library", "web-app", "agent-skill", "other"]) {
    const s = await fs.readFile(`templates/readme/${type}.md`, "utf8");
    assert.ok(s.indexOf("## Quick start") > s.indexOf("</picture>"));
    assert.ok(s.indexOf("## Quick start") < s.indexOf("## What you get"));
  }
});
test("showcase style relaxes copy limits but keeps empty wording banned", async () => {
  const { staticChecks } = await import("../scripts/lib/verify.mjs");
  const os = await import("node:os"), path = await import("node:path");
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-showcase-"));
  const badges = Array.from({ length: 6 }, (_, i) => `![b${i}](https://img.shields.io/badge/a-${i}-blue)`).join(" ");
  const body = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} gives readers one more concrete report detail.`).join("\n\n");
  const facts = { facts: [], manifest: {}, images: [], workflows: [], spdx: "MIT" };
  const v6 = async (extra, brief) => {
    await fs.writeFile(path.join(repo, "README.md"), `# demo\n\nTurn logs into a report.\n\n${badges}\n\n## ✨ Features\n\n${body}\n${extra}`);
    return (await staticChecks(repo, facts, brief)).find((c) => c.id === "V6");
  };
  assert.equal((await v6("", {})).status, "fail");
  assert.deepEqual((await v6("", { style: "showcase" })).issues, []);
  assert.match((await v6("\nIt is blazing fast.\n", { style: "showcase" })).issues.join(" "), /blazing fast/);
  const s = await fs.readFile("SKILL.md", "utf8");
  assert.ok(s.includes("prompts/showcase.md") && s.includes("brag.json"));
  const t = await fs.readFile("templates/readme/showcase.md", "utf8");
  assert.ok(t.indexOf("</picture>") < t.indexOf("## Quick start"));
});
