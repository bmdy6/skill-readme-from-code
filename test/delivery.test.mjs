import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { delivery, prepareStranger, scoreAnswers, storefront, report } from "../scripts/lib/delivery.mjs";
import { write } from "../scripts/lib/io.mjs";
const brief = {
  projectType: "agent-skill",
  audience: "developers",
  oneLiner: { en: "Give developers a README that proves its claims." },
  keyTerms: ["readme", "developer"],
  install: { command: "npx skills add moss/notes" },
  decidedBy: "agent",
  coreAction: { output: { keywords: ["README"] } },
};
test("stranger score requires all five independent checks", () => {
  const answers = {
    whatOutput: "A README",
    mostAppealing: "Clear examples",
    what: "A README skill",
    forWhom: "developers",
    firstCommand: "npx  skills add moss/notes",
    wouldTry: "yes",
    why: "Clear",
    confusing: ["One unknown."],
  };
  assert.equal(scoreAnswers(brief, answers).status, "pass");
  for (const key of [
    "what",
    "forWhom",
    "firstCommand",
    "wouldTry",
    "whatOutput",
  ])
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
  await write(path.join(work, "brief.json"), {
    ...brief,
    keyTerms: { what: ["readme"], audience: ["developers", "engineers"] },
  });
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

test("audience synonyms come from the brief and reject unrelated answers", () => {
  const positioned = {
    ...brief,
    keyTerms: {
      what: ["readme"],
      audience: ["developers", "engineers", "programmers", "开发者", "程序员"],
    },
  };
  for (const forWhom of positioned.keyTerms.audience) {
    assert.equal(scoreAnswers(positioned, { forWhom }).checks.forWhom, true);
  }
  for (const forWhom of ["designers", "README writers"]) {
    assert.equal(scoreAnswers(positioned, { forWhom }).checks.forWhom, false);
  }
  assert.equal(
    scoreAnswers(positioned, { what: "A README skill" }).checks.what,
    true,
  );
  assert.equal(
    scoreAnswers(positioned, { what: "engineers" }).checks.what,
    false,
  );
  assert.equal(
    scoreAnswers(
      {
        ...positioned,
        keyTerms: { what: ["readme"], audience: ["designers"] },
      },
      { forWhom: "designers" },
    ).checks.forWhom,
    true,
  );
});

test("P12 report discloses each side's remote image policy", async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-report-images-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const screen = { remoteImages: "neutral-placeholder", viewports: {} };
  await write(path.join(work, "before/audit.json"), {
    score: 80,
    checks: [{ id: "V2", screen }],
  });
  await write(path.join(work, "verify.json"), {
    score: 90,
    checks: [{ id: "V2", screen }],
  });
  const text = await report({ work });
  assert.match(text, /before=neutral-placeholder; after=neutral-placeholder/);
  assert.match(text, /same neutral placeholder \(--offline\)/);
});

for (const wins of [0, 1, 2, 3])
  test(`report completes delivery with ${wins}/3 blind wins`, async (t) => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-outcome-"));
    t.after(() => fs.rm(work, { recursive: true, force: true }));
    await write(path.join(work, "verify.json"), {
      ok: true,
      score: 100,
      checks: [],
    });
    await write(path.join(work, "stranger/result.json"), { status: "pass" });
    const readers = Array.from({ length: 3 }, (_, i) => ({
      status: i < wins ? "pass" : "fail",
      winner: i < wins ? "after" : "before",
      answers: {
        choice: "B",
        why: `Reader ${i + 1}: clearer source links.`,
        confusing: ["What does 10/10 cover?"],
      },
    }));
    await write(path.join(work, "stranger/blind-result.json"), {
      readers,
      improvements: ["Clarify the sampled-source scope."],
    });
    const text = await report({ work });
    assert.match(text, new RegExp(`${wins}/3`));
    for (const r of readers) assert.ok(text.includes(r.answers.why));
    assert.match(text, /Clarify the sampled-source scope/);
    const outcome = JSON.parse(
      await fs.readFile(path.join(work, "delivery.json"), "utf8"),
    );
    assert.equal(outcome.replaceReadme, wins >= 2);
    if (wins === 2) {
      await write(path.join(work, "stranger/result.json"), { status: "fail", outputMatch: "review" });
      await report({ work });
      const blocked = JSON.parse(await fs.readFile(path.join(work, "delivery.json"), "utf8"));
      assert.equal(blocked.replaceReadme, false);
    }
    if (wins < 2) {
      assert.match(text, /保留现有 README/);
      assert.match(text, /Do not open a replacement PR/);
      assert.equal(outcome.conclusion, "保留现有 README");
    }
  });
test("report never recommends replacement from a single, missing or invalid blind reader", async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-pending-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  for (const blind of [
    { status: "pass", winner: "after" },
    { readers: [] },
    {
      readers: [
        { winner: "after" },
        { winner: "after" },
        { winner: "invalid-label" },
      ],
    },
  ]) {
    await write(path.join(work, "stranger/blind-result.json"), blind);
    await report({ work });
    const outcome = JSON.parse(
      await fs.readFile(path.join(work, "delivery.json"), "utf8"),
    );
    assert.equal(outcome.replaceReadme, false);
    assert.equal(outcome.status, "not-run");
  }
});

test("report CLI accepts explicit blind evidence and completes a losing delivery with exit 0", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-report-cli-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const readers = ["after", "before", "before"].map((winner) => ({
    status: winner === "after" ? "pass" : "fail",
    winner,
    answers: { choice: "A", why: "Original wording.", confusing: [] },
  }));
  const input = path.join(work, "blind.json");
  await write(input, { readers, improvements: ["Keep clear labels."] });
  const text = execFileSync(
    process.execPath,
    ["scripts/run.mjs", "report", "--work", work, "--blind-results", input],
    { encoding: "utf8" },
  );
  assert.match(text, /保留现有 README/);
  assert.match(text, /1\/3/);
  await write(path.join(work, "verify.json"), { ok: false, checks: [] });
  await write(input, {
    readers: readers.map((r) => ({ ...r, winner: "after", status: "pass" })),
  });
  await report({ work, "blind-results": input });
  const outcome = JSON.parse(
    await fs.readFile(path.join(work, "delivery.json"), "utf8"),
  );
  assert.equal(outcome.replaceReadme, false);
});

test("GUI reader names the visible download label and a valid first step", () => {
  const gui = {
    ...brief,
    install: {
      url: "https://example.com/releases/latest",
      heading: "Install",
      label: "Download Example",
      stepKeywords: ["unzip", "extract"],
    },
  };
  const answers = {
    installLink: "Download Example",
    firstStep: "Extract the ZIP.",
  };
  assert.equal(scoreAnswers(gui, answers).checks.firstInstall, true);
  assert.equal(scoreAnswers(gui, { ...answers, firstStep: "Run npm install." }).checks.firstInstall, false);
  assert.equal(scoreAnswers(gui, { ...answers, installLink: "Source" }).checks.firstInstall, false);
});
test("output terms are project-specific and unrecognized answers retain an explicit review state", () => {
  const prose = "Revised Chinese prose that sounds more conversational.";
  const unrecognized = scoreAnswers(brief, { whatOutput: prose });
  assert.equal(unrecognized.outputMatch, "review");
  assert.equal(unrecognized.answers.whatOutput, prose);
  assert.equal(unrecognized.checks.whatOutput, false);
  const revised = { ...brief, coreAction: { output: { keywords: ["draft", "revised Chinese prose"] } } };
  assert.equal(scoreAnswers(revised, { whatOutput: prose }).checks.whatOutput, true);
  assert.equal(scoreAnswers(revised, { whatOutput: "A Chinese style profile" }).checks.whatOutput, false);
});

test("prepared GUI questions hide answer terms and reject later brief changes", async (t) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-reader-contract-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const original = {
    ...brief,
    install: {
      url: "https://example.com/releases/latest",
      heading: "Install",
      label: "Download Example",
      stepKeywords: ["extract"],
    },
  };
  await write(path.join(work, "brief.json"), original);
  const opts = { repo: path.resolve("evals/fixtures/clean"), work, offline: true };
  await prepareStranger(opts);
  const question = await fs.readFile(path.join(work, "stranger/questions.md"), "utf8");
  assert.match(question, /installLink, firstStep/);
  assert.doesNotMatch(question, /Download Example|extract|firstCommand/);
  const answers = path.join(work, "answers.json");
  await write(answers, { whatOutput: "Revised Chinese prose" });
  await write(path.join(work, "brief.json"), {
    ...original,
    coreAction: { output: { keywords: ["prose"] } },
  });
  await assert.rejects(delivery("stranger", { ...opts, action: "score", answers }), /Brief changed/);
  const prior = JSON.parse(await fs.readFile(path.join(work, "stranger/result.json"), "utf8"));
  assert.equal(prior.status, "not-run");
});
