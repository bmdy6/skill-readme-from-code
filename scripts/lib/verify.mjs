import fs from "node:fs/promises";
import path from "node:path";
import { read, json, write, exists, hash, readmeDocuments, checkEvidence } from "./io.mjs";
import { scan } from "./scan.mjs";
import {
  shellBlocks,
  headings,
  images,
  links,
  prose,
  proseParagraphs,
  leadText,
} from "./markdown.mjs";
import { firstScreen } from "./screen.mjs";
import { runCopy } from "./execute.mjs";
import { heroRelevance, retentionCheck } from "./evidence.mjs";
const check = (id, issues = [], extra = {}) => ({
  id,
  status: issues.length ? "fail" : "pass",
  issues,
  ...extra,
});
export async function staticChecks(repo, facts, brief = {}, opts = {}) {
  const documents = await readmeDocuments(repo, brief);
  const md = documents.find(d => d.language === "en")?.text || documents[0]?.text || "",
    zh = documents.find(d => d.language === "zh-CN")?.text || "";
  const bilingual = documents.some(d => d.language === "en") && !!zh;
  const checks = [];
  const linkIssues = [];
  for (const {file, text, language} of documents) {
    for (const link of links(text)) {
      if (/^https?:/.test(link)) {
        if (opts.online)
          try {
            const res = await fetch(link, {
              method: "HEAD",
              signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) linkIssues.push(`${file}: ${link} HTTP ${res.status}`);
          } catch (e) {
            linkIssues.push(`${file}: ${link}: ${e.message}`);
          }
        continue;
      }
      if (/^(mailto:|data:)/.test(link)) continue;
      const [p, anchor] = link.split("#");
      let target;
      try {
        target = decodeURIComponent(p || file);
      } catch {
        linkIssues.push(`Malformed link: ${link}`);
        continue;
      }
      const full = path.resolve(repo, target);
      if (!(await exists(full))) linkIssues.push(`${file}: missing ${link}`);
      else if (
        anchor &&
        /\.md$/.test(target) &&
        !headings(await read(full)).some(
          (h) => h.slug === decodeURIComponent(anchor),
        )
      )
        linkIssues.push(`${file}: missing anchor ${link}`);
    }
  }
  checks.push(
    check("V3", linkIssues, {
      externalLinks: opts.online ? "checked" : "not checked; use --online",
    }),
  );
  const imageIssues = [],
    referenced = documents.flatMap(d => links(d.text));
  const artInputs = await json(path.join(repo, "docs/readme/art.json"), {
    images: [],
  });
  for (const image of artInputs.images || []) {
    for (const input of image.screens || [])
      for (const value of typeof input === "string"
        ? [input]
        : Object.values(input))
        referenced.push(path.posix.join("docs/readme", value));
    if (image.captureId) {
      const c = await json(
        path.join(repo, "docs/readme/captures", image.captureId + ".json"),
      );
      for (const input of c?.artifacts || [])
        referenced.push(path.posix.join("docs/readme", input.file));
    }
  }

  for (const {file, text, language} of documents) {
    for (const img of images(text)) {
      if (!img.source && !img.alt?.trim())
        imageIssues.push(`${file}: missing image alt`);
      if (
        img.width &&
        (!Number.isFinite(Number(img.width)) || Number(img.width) > 900)
      )
        imageIssues.push(`${file}: image width exceeds 900`);
      if (!img.src) imageIssues.push(`${file}: missing image source`);
      else {
        referenced.push(img.src);
        if (
          !/^https?:|^data:/.test(img.src) &&
          !(await exists(path.resolve(repo, img.src)))
        )
          imageIssues.push(`${file}: missing ${img.src}`);
        if (
          !/badge|shields\.io|badgen/i.test(img.src) &&
          /\.(png|svg|jpe?g|webp)(?:$|\?)/.test(img.src)
        ) {
          if (language === "zh-CN" && !/\.zh-CN\.|(?:^|\/)(?:zh|zh-CN)\//.test(img.src))
            imageIssues.push(`${file}: English image ${img.src}`);
          if (language === "en" && /\.zh-CN\.|(?:^|\/)(?:zh|zh-CN)\//.test(img.src))
            imageIssues.push(`${file}: Chinese image ${img.src}`);
        }
      }
    }
    for (const p of text.matchAll(/<picture>[\s\S]*?<\/picture>/gi)) {
      const imgs = images(p[0]);
      if (
        !imgs.some((i) => /dark/.test(i.src || "")) ||
        !imgs.some((i) => /light/.test(i.src || ""))
      )
        imageIssues.push(`${file}: picture requires light and dark variants`);
    }
  }
  for (const img of facts.images.filter((i) => i.startsWith("docs/readme/")))
    if (!referenced.includes(img))
      imageIssues.push(`Unreferenced image: ${img}`);
  checks.push(check("V4", imageIssues));
  const truth = [];
  const all = documents.map(d => d.text).join("\n");
  if (/OWNER\/REPO|<your[-_…\w]|\bTODO\b|\blorem\b/i.test(all))
    truth.push("Placeholder text");
  const licenseText =
    md.match(/(?:^|\n)#{1,6}\s+License[^\n]*\n([\s\S]*?)(?=\n#|$)/i)?.[1] || "";
  const named =
    licenseText.match(/MIT|Apache-2\.0|GPL-3\.0(?:-only)?|BSD-3-Clause/g) || [];
  if (named.some((l) => l !== facts.spdx))
    truth.push(
      `License section disagrees with ${facts.spdx || "unknown SPDX"}`,
    );
  for (const badge of all.matchAll(/https?:[^\s)"<>]+/g)) {
    const u = decodeURIComponent(badge[0]);
    const l = u.match(/badge\/licen[cs]e-([^-/?]+(?:-[\d.]+)?)/i)?.[1];
    if (
      l &&
      facts.spdx &&
      !l.toLowerCase().startsWith(facts.spdx.toLowerCase())
    )
      truth.push("License badge mismatch");
    const v = u.match(/badge\/version-v?([\d.]+)/i)?.[1];
    if (v && v !== facts.manifest.version) truth.push("Version badge mismatch");
    const workflow = u.match(/actions\/workflows\/([^/?#]+)/)?.[1];
    if (workflow && !facts.workflows.includes(`.github/workflows/${workflow}`))
      truth.push(`Unknown CI workflow ${workflow}`);
  }
  for (const b of documents.flatMap(d => shellBlocks(d.text))) {
    const pkg = b.code.match(
      /npm (?:install|i)(?: (?:-g|--global))? ([\w@/.-]+)/,
    )?.[1];
    if (pkg && pkg !== facts.manifest.name && !["--"].includes(pkg))
      truth.push(`Install package differs from manifest: ${pkg}`);
    const remote = b.code
      .match(
        /(?:skills add|git clone)(?: https:\/\/github.com\/)?\s*([\w.-]+\/[\w.-]+)/,
      )?.[1]
      ?.replace(/\.git$/, "");
    if (remote && facts.remote && remote !== facts.remote)
      truth.push("Install repository differs from remote");
  }
  const claims = await json(
    path.join(repo, "docs/readme/claims.json"),
    await json(path.join(repo, "claims.json"), []),
  );
  for (const c of claims) {
    if (!all.includes(c.claim)) truth.push(`Claim absent: ${c.claim}`);
    if (
      !c.factIds?.length ||
      c.factIds.some((id) => !facts.facts.some((f) => f.id === id))
    )
      truth.push(`Unbacked claim: ${c.claim}`);
  }
  checks.push(check("V5", truth));
  const copy = [];
  for (const {file, text, language: lang} of documents) {
    const lead = leadText(text);
    if (lead) {
      const plain = lead.replace(/[\*_`]/g, "");
      if (
        /^(?:Help\s|A tool that\b|An agent skill that\b|This project\b|帮助|一个.*的工具)/i.test(
          plain,
        ) ||
        /using an agent skill/i.test(plain)
      )
        copy.push(`${file}: Generic one-liner`);
      const nouns = brief.coreAction?.output?.keywords?.length
        ? brief.coreAction.output.keywords
        : [
            "README",
            "draft",
            "text",
            "digest",
            "note",
            "report",
            "profile",
            "image",
            "package",
            "文字",
            "草稿",
            "文风档案",
            "档案",
            "笔记",
            "摘要",
            "报告",
            "图片",
          ];
      if (
        !nouns
          .filter(
            (n) =>
              typeof n === "string" &&
              !/^(?:better|best|easy|fast|powerful|seamless|更好|强大)$/i.test(
                n,
              ),
          )
          .some((n) => plain.toLowerCase().includes(n.toLowerCase()))
      )
        copy.push(`${file}: One-liner needs a concrete artifact noun`);
      const count =
        lang === "en"
          ? (plain.match(/\b[\w'-]+\b/g) || []).length
          : [...plain].length;
      if (count > (lang === "en" ? 20 : 40))
        copy.push(
          `${file}: One-liner exceeds ${lang === "en" ? 20 : 40} ${lang === "en" ? "words" : "characters"}`,
        );
    }
  }
  for (const { file, text } of documents) {
    // Work-log wording belongs in a PR, not in a README a stranger reads.
    const log = prose(text).match(
      /本轮|上一轮|第\s*[0-9一二三四五六七八九十]+\s*轮|\b(?:this|last|previous) round\b|\bin round \d+\b/i,
    );
    if (log) copy.push(`${file}: Work-log wording: ${log[0]}`);
    const lines = text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
    const title = lines.findIndex((l) => /^#\s|<h1[\s>]/i.test(l));
    if (
      title > 0 &&
      lines.slice(0, title).some((l) => /^\s*[^\s<\[!|>-]/.test(l))
    )
      copy.push(`${file}: Text before the title`);
  }
  const showcase = brief.style === "showcase";
  const budget = brief.wordBudget ?? (showcase ? 900 : 400);
  const badgeLimit = showcase ? 8 : 4;
  const words = prose(md).match(/\b[\w'-]+\b/g) || [];
  if (words.length > budget)
    copy.push(`Word budget: ${words.length} > ${budget}`);
  for (const para of proseParagraphs(md))
    if ((para.match(/[.!?。！？](?:\s|$)/g) || []).length > 3)
      copy.push("Paragraph exceeds three sentences");
  if (
    (md.match(/!\[[^\]]*\]\([^)]*(?:badge|shields\.io|badgen)[^)]*\)/gi) || [])
      .length > badgeLimit
  )
    copy.push(`More than ${showcase ? "eight" : "four"} badges`);
  if (!showcase && headings(md).some((h) => /\p{Extended_Pictographic}/u.test(h.text)))
    copy.push("Emoji heading");
  for (const term of ["blazing fast", "revolutionary", "seamless"])
    if (all.toLowerCase().includes(term)) copy.push(`Empty wording: ${term}`);
  const denied = opts["deny-words"]
    ? (await read(opts["deny-words"])).split(/\r?\n/).filter(Boolean)
    : [];
  const terms = [
    ...denied,
    ...(!brief.allowNamedAlternatives
      ? (facts.facts || [])
          .filter((f) => f.kind === "alternative")
          .map((f) => f.value)
          .filter(
            (t) =>
              !Object.keys({
                ...facts.manifest.dependencies,
                ...facts.manifest.devDependencies,
              }).includes(t),
          )
      : []),
  ];
  for (const t of terms)
    if (all.toLowerCase().includes(t.toLowerCase()))
      copy.push(`Forbidden term: ${t}`);
  checks.push(check("V6", copy, { wordCount: words.length }));
  if (!bilingual)
    checks.push({
      id: "V7",
      status: brief.languages?.some(lang => !documents.some(d => d.language === lang)) ? "fail" : "skip",
      reason: "Only one README language present",
      issues: brief.languages?.some(lang => !documents.some(d => d.language === lang))
        ? ["Requested language missing"]
        : [],
    });
  else {
    const issues = [];
    const sections = [
      ["Quick start", "快速开始", "使用"],
      ["What you get", "Why", "你会得到什么", "为什么"],
      ["How it works", "如何工作", "工作流程"],
      ["Options", "选项", "Commands / options", "命令与选项"],
      [
        "FAQ and boundaries",
        "常见问题和边界",
        "FAQ / limitations",
        "常见问题与限制",
      ],
      ["Contributing", "参与贡献"],
      ["License", "许可证", "许可"],
    ];
    const keys = (text) =>
      headings(text).map((h) => [
        h.depth,
        sections.findIndex((names) =>
          names.some((n) => n.toLowerCase() === h.text.toLowerCase()),
        ),
      ]);
    const reference = documents.find(d => d.language === "en");
    for (const document of documents.filter(d => d !== reference)) {
      const a = reference.text, b = document.text;
      const aKeys = keys(a), bKeys = keys(b);
      const prefix = document.file + ": ";
      if (aKeys.some((a, i) => a[1] >= 0 && bKeys[i]?.[1] >= 0 && a[1] !== bKeys[i][1]))
        issues.push(prefix + "Translated heading order differs");
      if (JSON.stringify(headings(a).map(h => h.depth)) !== JSON.stringify(headings(b).map(h => h.depth)))
        issues.push(prefix + "Heading structure/order differs");
      if (JSON.stringify(shellBlocks(a).map(b => b.code)) !== JSON.stringify(shellBlocks(b).map(b => b.code)))
        issues.push(prefix + "Shell blocks differ");
      const norm = text => images(text).map(i => i.src?.replace(/\.zh-CN(?=\.)/g, "").replace(/\/(?:en|zh|zh-CN)\//g, "/LANG/"));
      if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b)))
        issues.push(prefix + "Image sequence differs");
    }
    checks.push(check("V7", issues));
  }
  return checks;
}
async function base(opts) {
  const facts = await scan(opts.repo, { github: false });
  const supplements = await json(
    path.join(opts.repo, "docs/readme/facts.json"),
    await json(path.join(opts.work, "facts.json"), []),
  );
  const sourceIssues = [];
  for (const f of Array.isArray(supplements)
    ? supplements
    : supplements.facts || []) {
    if (
      typeof f.id !== "string" ||
      !f.id.trim() ||
      typeof f.claim !== "string" ||
      !f.claim.trim()
    ) {
      sourceIssues.push(`Invalid supplemental fact fields: ${f.id}`);
      continue;
    }
    if (facts.facts.some((x) => x.id === f.id)) continue;
    const match =
      typeof f.source === "string" && f.source.match(/^(.+):(\d+)$/);
    const source = match && path.resolve(opts.repo, match[1]);
    if (
      !match ||
      !source.startsWith(path.resolve(opts.repo) + path.sep) ||
      typeof f.value !== "string" ||
      !f.value.trim() ||
      !(await read(source)).split("\n")[Number(match[2]) - 1]?.includes(f.value)
    )
      sourceIssues.push(`Invalid supplemental fact source: ${f.id}`);
    else facts.facts.push(f);
  }
  const brief = await json(
    opts.brief || path.join(opts.work, "brief.json"),
    {},
  );
  const checks = await staticChecks(opts.repo, facts, brief, opts);
  checks.find((c) => c.id === "V5").issues.push(...sourceIssues);
  if (sourceIssues.length) checks.find((c) => c.id === "V5").status = "fail";
  let screen;
  try {
    screen = await firstScreen({ ...opts, install: brief.install });
    checks.unshift(
      check(
        "V2",
        Object.entries(screen.viewports.desktop.checks)
          .filter(([k, v]) => !v && !(k === "install" && brief.style === "showcase"))
          .map(([k]) => `${k} is not fully visible on desktop`),
        { screen },
      ),
    );
  } catch (e) {
    checks.unshift(check("V2", [e.message]));
  }
  return { facts, brief, checks };
}
export function reportMarkdown(result, title) {
  return `# ${title}\n\nScore: ${result.score}/100\n\n| Check | Result | Evidence |\n|---|---|---|\n${result.checks.map((c) => `| ${c.id} | ${c.status} | ${checkEvidence(c).replace(/\|/g, "\\|")} |`).join("\n")}\n\n${result.checks.find((c) => c.id === "V2")?.screen?.renderer || "No screen renderer"}\n`;
}
export async function audit(opts) {
  const { checks } = await base(opts);
  const r = {
    mode: "audit",
    checks,
    score: Math.round(
      (checks.filter((c) => c.status === "pass").length /
        checks.filter((c) => c.status !== "skip").length) *
        100,
    ),
  };
  await write(path.join(opts.work, "audit.json"), r);
  await write(
    path.join(opts.work, "audit.md"),
    reportMarkdown(r, "README audit"),
  );
  return r;
}
export async function verify(opts) {
  const { facts, brief, checks } = await base(opts),
    commandResults = [];
  const plan = await json(
    opts.plan || path.join(opts.work, "command-plan.json"),
    { blocks: [] },
  );
  const documents = await readmeDocuments(opts.repo, brief);
  for (const {file} of documents)
    for (const b of shellBlocks(await read(path.join(opts.repo, file)))) {
      const rule = plan.blocks?.find(
        (r) =>
          (!r.file || r.file === file) &&
          (r.code === b.code || r.index === b.index),
      );
      if (!rule) {
        commandResults.push({
          ...b,
          file,
          status: "fail",
          reason: "No command plan",
        });
        continue;
      }
      if (rule.skip) {
        commandResults.push({ ...b, file, status: "skip", reason: rule.skip });
        continue;
      }
      const run = await runCopy(opts.repo, b.code, {
        tty: rule.tty,
        shareGitHubAuth: rule.shareGitHubAuth === true,
        timeoutMs: rule.timeoutMs ?? 60000,
      });
      let stdoutMatches = true,
        reason;
      try {
        if (rule.expectStdout !== undefined) {
          if (typeof rule.expectStdout !== "string")
            throw Error("expectStdout must be a regex string");
          stdoutMatches = new RegExp(rule.expectStdout).test(run.stdout);
          if (!stdoutMatches) reason = "stdout did not match expectStdout";
        }
      } catch (e) {
        stdoutMatches = false;
        reason = `Invalid expectStdout: ${e.message}`;
      }
      const interactive =
        /^\s*\?\s/m.test(run.stdout) ||
        /\bGlobal\b[\s\S]*\bProject\b/i.test(run.stdout);
      const receipt = rule.expectStdout !== undefined && stdoutMatches;
      const warnings =
        interactive && !receipt
          ? [
              "Interactive selection without a matched completion receipt; exit 0 does not prove installation.",
            ]
          : [];
      commandResults.push({
        ...b,
        file,
        ...run,
        reason,
        stdoutMatches,
        warnings,
        status:
          !run.timedOut &&
          run.exitCode === (rule.expectExit ?? 0) &&
          stdoutMatches
            ? "pass"
            : "fail",
      });
    }
  checks.unshift(
    check(
      "V1",
      commandResults
        .filter((r) => r.status === "fail")
        .map(
          (r) =>
            `${r.file} block ${r.index}: ${r.reason || `exit ${r.exitCode}`}`,
        ),
      {
        results: commandResults,
        warnings: commandResults.flatMap((r) => [
          ...(r.status === "skip" ? [`${r.file} block ${r.index}: ${r.reason}`] : []),
          ...(r.warnings || []).map((w) => `${r.file} block ${r.index}: ${w}`),
        ]),
      },
    ),
  );
  if (!commandResults.length || commandResults.every(r => r.status === "skip")) {
    const v1 = checks.find(c => c.id === "V1");
    v1.status = "skip";
    v1.reason = commandResults.length ? "No README commands executed" : "No README shell blocks";
  }
  const projectTests = plan.projectTests;
  const invalidProjectTests =
    projectTests &&
    ((projectTests.skip !== undefined && projectTests.command !== undefined) ||
      (projectTests.timeoutMs !== undefined && (!Number.isSafeInteger(projectTests.timeoutMs) || projectTests.timeoutMs <= 0 || projectTests.timeoutMs > 3600000)) ||
      ![projectTests.skip, projectTests.command].some(
        (v) => typeof v === "string" && v.trim(),
      ));
  if (invalidProjectTests)
    checks.push(
      check("V8", [
        "projectTests needs exactly one nonempty skip reason or command",
      ]),
    );
  else if (projectTests?.skip)
    checks.push({
      id: "V8",
      status: "skip",
      reason: projectTests.skip,
      issues: [],
    });
  else if (!projectTests?.command && !facts.testCommands.length)
    checks.push({
      id: "V8",
      status: "skip",
      reason: "No test command discovered",
      issues: [],
    });
  else {
    const results = [];
    for (const cmd of projectTests?.command
      ? [projectTests.command]
      : facts.testCommands)
      results.push(await runCopy(opts.repo, cmd, {timeoutMs: projectTests?.timeoutMs ?? 60000}));
    checks.push(
      check(
        "V8",
        results
          .filter((r) => r.exitCode !== 0 || r.timedOut)
          .map((r) => `${r.command}: exit ${r.exitCode}`),
        { results },
      ),
    );
  }
  const manifest = await json(
    path.join(opts.repo, "docs/readme/art-manifest.json"),
  );
  const artIssues = [];
  if (!manifest) artIssues.push("Missing art manifest");
  else if (!manifest.files?.length) artIssues.push("Empty art manifest");
  else
    for (const f of manifest.files) {
      const full = path.resolve(opts.repo, "docs/readme", f.file);
      if (!(await exists(full))) artIssues.push(`Missing ${f.file}`);
      else if (hash(await fs.readFile(full)) !== f.sha256)
        artIssues.push(`Hash mismatch ${f.file}`);
      if (
        !f.checks ||
        [
          "overflow",
          "fontSize",
          "contrast",
          "fields",
          "size",
          "mainText",
          "density",
          "balance",
          ...(f.template === "hero-link" ? ["links"] : []),
        ].some((k) => f.checks[k] !== "pass")
      )
        artIssues.push(`Failed or absent self-check ${f.file}`);
    }
  // Measure the actual README rendering, including picture-selected dark variants.
  if (manifest?.files?.length) {
    for (const {file: readme} of documents) {
      const screens =
        readme === "README.md"
          ? checks.find((c) => c.id === "V2")?.screen
          : await firstScreen({
              ...opts,
              readme,
              work: path.join(opts.work, readme + "-screen"),
            });
      for (const [viewport, screen] of Object.entries(
        screens?.viewports || {},
      )) {
        if (viewport === "mobile") continue; // informational viewport, as in V2
        for (const image of screen.images || []) {
          const f = manifest.files.find((f) =>
            image.src.endsWith("/docs/readme/" + f.file),
          );
          if (!f) continue;
          const scaled =
            f.minMainFontSize * Math.min(1, image.width / f.cssWidth);
          if (!Number.isFinite(scaled) || scaled < 13)
            artIssues.push(
              `${readme} ${viewport}: display-scaled primary font below 13px in ${f.file} (${scaled.toFixed(2)}px)`,
            );
        }
      }
    }
  }
  checks.push(check("V9", artIssues));
  checks.push(await heroRelevance(opts.repo, brief, facts));
  checks.push(await retentionCheck(opts.repo, opts));
  checks.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const r = {
    mode: "verify",
    ok: !checks.some((c) => c.status === "fail"),
    checks,
    score: Math.round(
      (checks.filter((c) => c.status === "pass").length /
        checks.filter((c) => c.status !== "skip").length) *
        100,
    ),
    summary: Object.fromEntries(
      ["pass", "fail", "skip"].map((s) => [
        s,
        checks.filter((c) => c.status === s).length,
      ]),
    ),
  };
  await write(path.join(opts.work, "verify.json"), r);
  await write(
    path.join(opts.work, "verify.md"),
    reportMarkdown(r, "README verification"),
  );
  return r;
}
