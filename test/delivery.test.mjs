import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scoreAnswers, storefront, report } from "../scripts/lib/delivery.mjs";
import { write } from "../scripts/lib/io.mjs";
const brief = {
  projectType: "agent-skill",
  audience: "developers",
  oneLiner: { en: "Give developers a README that proves its claims." },
  keyTerms: ["readme", "developer"],
  install: { command: "npx skills add moss/notes" },
  decidedBy: "agent",
  coreAction:{output:{keywords:["README"]}},
};
test("stranger score requires all five independent checks", () => {
  const answers = {
    whatOutput:"A README",mostAppealing:"Clear examples",
    what: "A README skill",
    forWhom: "developers",
    firstCommand: "npx  skills add moss/notes",
    wouldTry: "yes",
    why: "Clear",
    confusing: ["One unknown."],
  };
  assert.equal(scoreAnswers(brief, answers).status, "pass");
  for (const key of ["what", "forWhom", "firstCommand", "wouldTry","whatOutput"])
    assert.equal(
      scoreAnswers(brief, { ...answers, [key]: "wrong" }).status,
      "fail",
      key,
    );
  assert.deepEqual(
    scoreAnswers(brief, answers).answers.confusing,
    answers.confusing,
  );
});
test("report names missing evidence and agent decisions", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-report-"));
  await write(path.join(work, "brief.json"), brief);
  const text = await report({ work });
  assert.match(text, /not-run/);
  assert.match(text, /agent/);
  assert.match(text, /Not verified/);
});
test("storefront makes valid topics and a small social image", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-store-"));
  await write(path.join(work, "brief.json"), brief);
  const r = await storefront({
    repo: path.resolve("evals/fixtures/agent-skill"),
    work,
  });
  assert.ok([...r.about].length <= 120);
  assert.ok(r.topics.length >= 5 && r.topics.length <= 8);
  assert.ok(r.topics.every((t) => /^[a-z0-9-]{1,50}$/.test(t)));
  assert.ok(
    (await fs.stat(path.join(work, "social-light.png"))).size < 1_000_000,
  );
});
