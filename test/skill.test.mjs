import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
test("skill names every command, gates and hard delivery boundaries", async () => {
  const s = await fs.readFile("SKILL.md", "utf8");
  assert.ok(s.split("\n").length <= 250);
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
