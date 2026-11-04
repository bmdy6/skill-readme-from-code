import fs from "node:fs/promises";
import path from "node:path";
import { json, write, read } from "./io.mjs";
import { firstScreen } from "./screen.mjs";
import { renderArt } from "./art.mjs";
import { scan } from "./scan.mjs";
export function scoreAnswers(brief, answers) {
  const norm = (s) =>
      String(s || "")
        .trim()
        .replace(/\s+/g, " "),
    hit = (s) =>
      (brief.keyTerms || []).some((t) =>
        String(s || "")
          .toLowerCase()
          .includes(t.toLowerCase()),
      );
  const checks = {
    what: hit(answers.what),
    forWhom: hit(answers.forWhom),
    firstCommand:
      !!brief.install?.command &&
      norm(answers.firstCommand) === norm(brief.install.command),
    wouldTry: answers.wouldTry === "yes",
  };
  return {
    status: Object.values(checks).every(Boolean) ? "pass" : "fail",
    checks,
    answers,
  };
}
export async function prepareStranger(opts) {
  const brief = await json(opts.brief || path.join(opts.work, "brief.json"));
  if (!brief) throw Error("Missing brief.json");
  const out = path.join(opts.work, "stranger");
  await firstScreen({ ...opts, work: out, install: brief.install.command });
  await write(
    path.join(out, "questions.md"),
    "Look only at the attached first-screen image. Do not inspect files, browse, or use tools. What is this? Who is it for? What exact first command should a new user copy? Would you try it, and why? What is confusing? Return only JSON with keys what, forWhom, firstCommand, wouldTry (yes/no), why, confusing (array).\n",
  );
  await write(path.join(out, "result.json"), {
    status: "not-run",
    reason: "Prepared; waiting for an independent stranger response",
  });
  return out;
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
        ...(brief.keyTerms || []),
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
        result: { en: brief.install.command, "zh-CN": brief.install.command },
        illustration: true,
      },
    ],
  });
  const art = await renderArt({ spec, out, work: opts.work });
  if (art.files.some((f) => Object.values(f.checks).some((v) => v !== "pass")))
    throw Error("Social image self-check failed");
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
  const screen = (r) => r?.checks?.find((c) => c.id === "V2")?.screen;
  const screenshots = (label, screen, dir) =>
    screen
      ? Object.entries(screen.viewports)
          .map(([name, v]) => `![${label} ${name}](${dir}/${v.screenshot})`)
          .join("\n\n")
      : `${label}: not-run`;
  const text = `# README delivery\n\nBefore: ${before?.score ?? "not-run"}/100. After: ${after?.score ?? "not-run"}/100.\n\n${screenshots("Before", screen(before), "before")}\n\n${screenshots("After", screen(after), ".")}\n\n## Verification\n\n| Check | Status | Evidence |\n|---|---|---|\n${(after?.checks || []).map((c) => `| ${c.id} | ${c.status} | ${(c.issues?.join("; ") || c.reason || "Passed").replace(/\|/g, "\\|")} |`).join("\n")}\n\n## Stranger\n\n${JSON.stringify(stranger, null, 2)}\n\n## Images\n\n${art.files.map((f) => `- ${f.file}: ${f.kind}; ${Object.values(f.checks).every((s) => s === "pass") ? "self-check pass" : "self-check fail"}`).join("\n") || "not-run"}\n\n## Gates\n\nG1: ${brief.gates?.G1?.decidedBy || brief.decidedBy || "not recorded"}. G2: ${brief.gates?.G2?.decidedBy || brief.decidedBy || "not recorded"}.\n\n${JSON.stringify(brief.gates || {}, null, 2)}\n\n## Not verified\n\n${[...(!after ? ["- Verification not-run"] : []), ...(!before ? ["- Before audit not-run"] : []), ...(after?.checks?.filter((c) => c.status !== "pass").map((c) => `- ${c.id}: ${c.status}; ${c.reason || c.issues?.join("; ")}`) || []), ...(stranger.status === "not-run" ? [`- Stranger not-run: ${stranger.reason}`] : []), "- External links only checked when --online was requested.", `- Renderer: ${screen(after)?.renderer || "not-run"}${screen(after)?.fallbackReason ? `; ${screen(after).fallbackReason}` : ""}.`].join("\n")}\n`;
  await write(path.join(opts.work, "pr-body.md"), text);
  return text;
}
export async function delivery(command, opts) {
  if (command === "stranger") {
    if (opts.action === "prepare") console.log(await prepareStranger(opts));
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
