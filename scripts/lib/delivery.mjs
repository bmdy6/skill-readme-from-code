import fs from "node:fs/promises";
import { randomInt } from "node:crypto";
import path from "node:path";
import { json, write, read, hash } from "./io.mjs";
import { firstScreen } from "./screen.mjs";
import { renderArt } from "./art.mjs";
import { scan } from "./scan.mjs";
// Legacy briefs used one shared array; new G1 briefs keep audience synonyms separate.
function termsFor(brief, field) {
  const terms = brief.keyTerms || [];
  return Array.isArray(terms) ? terms : terms[field] || [];
}
// Only English morphology is normalized; commands retain exact normalized equality.
export function normalizeTerms(s) {
  return String(s || "")
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[-\s]+/g, " ")
    .replace(/[a-z]+/g, (word) => {
      if (word.endsWith("ies") && word.length > 3)
        return word.slice(0, -3) + "y";
      if (/(?:sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
      if (word.endsWith("s") && word.length > 3 && !/(?:ss|us|is)$/.test(word))
        return word.slice(0, -1);
      return word;
    })
    .trim();
}
function hasTerm(answer, term) {
  const a = normalizeTerms(answer),
    t = normalizeTerms(term);
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(a);
}
export function scoreAnswers(brief, answers) {
  const norm = (s) =>
      String(s || "")
        .trim()
        .replace(/\s+/g, " "),
    hit = (s, field) => termsFor(brief, field).some((t) => hasTerm(s, t));
  const install = brief.install;
  const outputMatch = (brief.coreAction?.output?.keywords || []).some((t) =>
    hasTerm(answers.whatOutput, t),
  );
  const checks = {
    what: hit(answers.what, "what"),
    forWhom: hit(answers.forWhom, "audience"),
    ...(install?.url
      ? {
          firstInstall:
            !!install.label &&
            norm(answers.installLink) === norm(install.label) &&
            (install.stepKeywords || []).some((term) =>
              hasTerm(answers.firstStep, term),
            ),
        }
      : {
          firstCommand:
            !!install?.command &&
            norm(answers.firstCommand) === norm(install.command),
        }),
    wouldTry: answers.wouldTry === "yes",
    whatOutput: outputMatch,
  };
  return {
    status: Object.values(checks).every(Boolean) ? "pass" : "fail",
    checks,
    outputMatch: outputMatch ? "matched" : norm(answers.whatOutput) ? "review" : "missing",
    answers,
  };
}
export async function prepareStranger(opts) {
  const brief = await json(opts.brief || path.join(opts.work, "brief.json"));
  if (!brief) throw Error("Missing brief.json");
  const out = path.join(opts.work, "stranger");
  await firstScreen({ ...opts, work: out, install: brief.install });
  const installation = brief.install?.url
    ? {
        question: "What exact download link label is visible, and what should a new user do first after downloading?",
        keys: "installLink, firstStep",
      }
    : {
        question: "What exact first command should a new user copy?",
        keys: "firstCommand",
      };
  await write(path.join(out, "brief-hash.json"), { sha256: hash(JSON.stringify(brief)) });
  await write(
    path.join(out, "questions.md"),
    `Look only at the attached first-screen image. Do not inspect files, browse, or use tools. What is this? Who is it for? ${installation.question} Would you try it, and why? What does the output look like? What appeals to you most? What is confusing? Return only JSON with keys what, forWhom, ${installation.keys}, wouldTry (yes/no), why, whatOutput, mostAppealing, confusing (array).\n`,
  );
  await write(path.join(out, "result.json"), {
    status: "not-run",
    reason: "Prepared; waiting for an independent stranger response",
  });
  return out;
}
export async function prepareBlind(opts) {
  if (!opts.before || !opts.after)
    throw Error("blind-prepare needs --before and --after image files");
  const draw = randomInt(2),
    order = draw ? ["after", "before"] : ["before", "after"];
  const labels = {};
  for (const [i, label] of ["A", "B"].entries()) {
    const source = order[i],
      bytes = await fs.readFile(opts[source]);
    labels[label] = { source, sha256: hash(bytes) };
    await fs.mkdir(path.join(opts.work, "stranger/blind-input"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(opts.work, "stranger/blind-input", label + ".png"),
      bytes,
    );
  }
  const m = { randomization: { method: "crypto.randomInt(2)", draw }, labels };
  await write(path.join(opts.work, "stranger/blind-manifest.json"), m);
  await write(path.join(opts.work, "stranger/blind-result.json"), {
    status: "not-run",
    reason: "Waiting for a fresh independent blind choice",
  });
  await write(
    path.join(opts.work, "stranger/blind-input/questions.md"),
    'Only view the two supplied screenshots. The first is A, the second is B. Which would you rather try, and why? Do not use tools or read any files. Return only JSON: {"choice":"A or B","why":"reason","confusing":[]}.',
  );
  return m;
}
export async function scoreBlind(opts, answers) {
  const m = await json(path.join(opts.work, "stranger/blind-manifest.json"));
  if (!m) throw Error("Missing blind manifest");
  const winner = m.labels?.[answers.choice]?.source;
  const r = {
    status: winner === "after" ? "pass" : "fail",
    winner: winner || "invalid-label",
    answers,
    randomization: m.randomization,
    labels: m.labels,
  };
  await write(path.join(opts.work, "stranger/blind-result.json"), r);
  return r;
}
export async function storefront(opts) {
  const brief = await json(opts.brief || path.join(opts.work, "brief.json"));
  if (!brief) throw Error("Missing brief.json");
  const facts = await scan(opts.repo, { github: false });
  const about = [...brief.oneLiner.en].slice(0, 120).join("");
  const topics = [
    ...new Set(
      [
        brief.projectType,
        ...(facts.manifest.keywords || []),
        ...termsFor(brief, "what"),
        ...termsFor(brief, "audience"),
        "documentation",
        "developer-tools",
        "automation",
        "agent-skills",
      ].map((t) =>
        t
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .slice(0, 50),
      ),
    ),
  ].slice(0, 8);
  const installText = brief.install.command || brief.install.label;
  const out = path.join(opts.work, "storefront-art");
  const spec = path.join(opts.work, "storefront-art.json");
  await write(spec, {
    accent: brief.accent,
    images: [
      {
        id: "social",
        template: "social",
        title: {
          en: facts.manifest.name || path.basename(opts.repo),
          "zh-CN": facts.manifest.name || path.basename(opts.repo),
        },
        subtitle: { en: about, "zh-CN": brief.oneLiner["zh-CN"] || about },
        result: { en: installText, "zh-CN": installText },
        illustration: true,
      },
    ],
  });
  const art = await renderArt({ spec, out, work: opts.work });
  if (art.files.some((f) => Object.values(f.checks).some((v) => v !== "pass")))
    throw Error(
      "Social image self-check failed: " +
        JSON.stringify(
          art.files
            .filter((f) => Object.values(f.checks).some((v) => v !== "pass"))
            .map((f) => ({
              file: f.file,
              problems: f.problems,
              contentRatio: f.contentRatio,
            })),
        ),
    );
  await fs.copyFile(
    path.join(out, "social-light.png"),
    path.join(opts.work, "social-light.png"),
  );
  const result = { about, topics };
  await write(
    path.join(opts.work, "storefront.md"),
    `# Storefront suggestions\n\nApply manually in repository settings. This command never changes settings.\n\nAbout: ${about}\n\nTopics: ${topics.join(", ")}\n\nSocial image: social-light.png (1280 × 640; illustration)\n`,
  );
  return result;
}
export async function report(opts) {
  const before = await json(
      path.join(opts.before || path.join(opts.work, "before"), "audit.json"),
    ),
    after = await json(path.join(opts.work, "verify.json")),
    brief = await json(path.join(opts.work, "brief.json"), {}),
    stranger = await json(path.join(opts.work, "stranger/result.json"), {
      status: "not-run",
      reason: "No independent stranger result supplied",
    }),
    art = await json(
      path.join(opts.repo || ".", "docs/readme/art-manifest.json"),
      { files: [] },
    );
  const blind = await json(
    opts["blind-results"] || path.join(opts.work, "stranger/blind-result.json"),
    { status: "not-run" },
  );
  const readers = blind.readers || [];
  const complete =
    readers.length === 3 &&
    readers.every(
      (r) =>
        ["before", "after"].includes(r.winner) &&
        r.status === (r.winner === "after" ? "pass" : "fail") &&
        ["A", "B"].includes(r.answers?.choice) &&
        typeof r.answers?.why === "string" &&
        r.answers.why.trim(),
    );
  const wins = readers.filter((r) => r.winner === "after").length;
  const won = complete && wins >= 2;
  const replaceReadme = won && after?.ok === true && stranger.status === "pass";
  const outcome = {
    status: complete ? (won ? "pass" : "fail") : "not-run",
    wins,
    readers: readers.length,
    replaceReadme,
    conclusion:
      complete && !won
        ? "保留现有 README"
        : replaceReadme
          ? "新版赢得盲选，可提交替换 PR 供审查"
          : "交付待验证，保留现有 README",
    action: replaceReadme
      ? "With user authorization, open a replacement PR for review."
      : "Do not open a replacement PR.",
  };
  await write(path.join(opts.work, "delivery.json"), outcome);
  const decision = `${outcome.conclusion}\n\nBlind choice: ${complete ? `${wins}/3` : "not-run (requires exactly three valid fresh readers)"}. ${outcome.action}`;
  const improvements =
    (blind.improvements || []).map((s) => `- ${s}`).join("\n") ||
    "No improvement points recorded; review the verbatim reader feedback above.";
  const screen = (r) => r?.checks?.find((c) => c.id === "V2")?.screen;
  const screenshots = (label, screen, dir) =>
    screen
      ? Object.entries(screen.viewports)
          .map(([name, v]) => `![${label} ${name}](${dir}/${v.screenshot})`)
          .join("\n\n")
      : `${label}: not-run`;
  const text = `# README delivery\n\n${decision}\n\nBefore: ${before?.score ?? "not-run"}/100. After: ${after?.score ?? "not-run"}/100.\n\n${screenshots("Before", screen(before), "before")}\n\n${screenshots("After", screen(after), ".")}\n\nRemote images: before=${screen(before)?.remoteImages || "not-recorded"}; after=${screen(after)?.remoteImages || "not-recorded"}. neutral-placeholder means all remote images use the same neutral placeholder (--offline).\n\n## Verification\n\n| Check | Status | Evidence |\n|---|---|---|\n${(after?.checks || []).map((c) => `| ${c.id} | ${c.status} | ${(c.issues?.join("; ") || c.reason || c.warnings?.join("; ") || "Passed").replace(/\|/g, "\\|")} |`).join("\n")}\n\n## Stranger\n\n${JSON.stringify(stranger, null, 2)}\n\n## Blind choice\n\n${JSON.stringify(blind, null, 2)}\n\n## Improvements to borrow\n\n${improvements}\n\n## Images\n\n${art.files.map((f) => `- ${f.file}: ${f.kind}; ${Object.values(f.checks).every((s) => s === "pass") ? "self-check pass" : "self-check fail"}`).join("\n") || "not-run"}\n\n## Gates\n\nG1: ${brief.gates?.G1?.decidedBy || brief.decidedBy || "not recorded"}. G2: ${brief.gates?.G2?.decidedBy || brief.decidedBy || "not recorded"}.\n\n${JSON.stringify(brief.gates || {}, null, 2)}\n\n## Intentional deletions\n\n${JSON.stringify(after?.checks?.find((c) => c.id === "V11")?.intentionalDeletions || [], null, 2)}\n\n## Not verified\n\n${[...(!after ? ["- Verification not-run"] : []), ...(!before ? ["- Before audit not-run"] : []), ...(after?.checks?.filter((c) => c.status !== "pass").map((c) => `- ${c.id}: ${c.status}; ${c.reason || c.issues?.join("; ")}`) || []), ...(stranger.status === "not-run" ? [`- Stranger not-run: ${stranger.reason}`] : []), "- External links only checked when --online was requested.", `- Renderer: ${screen(after)?.renderer || "not-run"}${screen(after)?.fallbackReason ? `; ${screen(after).fallbackReason}` : ""}.`].join("\n")}\n`;
  await write(path.join(opts.work, "pr-body.md"), text);
  return text;
}
export async function delivery(command, opts) {
  if (command === "stranger") {
    if (opts.action === "blind-prepare") console.log(await prepareBlind(opts));
    else if (opts.action === "blind-score") {
      if (!opts.answers) throw Error("blind-score needs --answers");
      const r = await scoreBlind(opts, await json(opts.answers));
      console.log(JSON.stringify(r, null, 2));
      if (r.status === "fail") process.exitCode = 1;
    } else if (opts.action === "prepare")
      console.log(await prepareStranger(opts));
    else if (opts.action === "score") {
      let result;
      if (opts["not-run"])
        result = { status: "not-run", reason: String(opts["not-run"]) };
      else {
        if (!opts.answers)
          throw Error("stranger score requires --answers or --not-run");
        const brief = await json(
          opts.brief || path.join(opts.work, "brief.json"),
        );
        const answers = await json(opts.answers);
        if (!brief || !answers) throw Error("Missing brief or answers");
        const prepared = await json(path.join(opts.work, "stranger/brief-hash.json"));
        if (prepared && prepared.sha256 !== hash(JSON.stringify(brief)))
          throw Error("Brief changed since stranger prepare; preserve the previous result and prepare a fresh reader in a new work directory");
        result = scoreAnswers(brief, answers);
      }
      await write(path.join(opts.work, "stranger/result.json"), result);
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "fail") process.exitCode = 1;
    } else throw Error("stranger action must be prepare or score");
  } else if (command === "storefront") console.log(await storefront(opts));
  else if (command === "report") console.log(await report(opts));
  else throw Error(`Unknown command: ${command}`);
}
