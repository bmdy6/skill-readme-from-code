import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";
import { read, json, write, exists, hash } from "./io.mjs";
import { scan } from "./scan.mjs";
import { shellBlocks, headings, images, links, prose } from "./markdown.mjs";
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
  const md = await read(path.join(repo, "README.md")),
    zh = await read(path.join(repo, "README.zh-CN.md"));
  const checks = [];
  const linkIssues = [];
  for (const [file, text] of [
    ["README.md", md],
    ...(zh ? [["README.zh-CN.md", zh]] : []),
  ]) {
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
    referenced = [...links(md), ...links(zh)];
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

  for (const [file, text] of [
    ["README.md", md],
    ...(zh ? [["README.zh-CN.md", zh]] : []),
  ]) {
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
          if (file === "README.zh-CN.md" && !/\.zh-CN\./.test(img.src))
            imageIssues.push(`${file}: English image ${img.src}`);
          if (file === "README.md" && /\.zh-CN\./.test(img.src))
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
  const all = md + "\n" + zh;
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
  for (const b of shellBlocks(md)) {
    const pkg = b.code.match(/npm (?:install|i)(?: -g)? ([\w@/.-]+)/)?.[1];
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
  for (const [file, text, lang] of [
    ["README.md", md, "en"],
    ...(zh ? [["README.zh-CN.md", zh, "zh-CN"]] : []),
  ]) {
    const lead = marked
      .lexer(text)
      .find(
        (t) =>
          t.type === "paragraph" && !/^!?\[/.test(t.text) && !/^</.test(t.text),
      )?.text;
    if (lead) {
      const plain = lead.replace(/[\*_`]/g, "");
      if (
        /^(?:Help\s|A tool that\b|An agent skill that\b|This project\b|帮助|一个.*的工具)/i.test(
          plain,
        ) ||
        /using an agent skill/i.test(plain)
      )
        copy.push(`${file}: Generic one-liner`);
      const nouns = [
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
      if (!nouns.some((n) => plain.toLowerCase().includes(n.toLowerCase())))
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
  const words = prose(md).match(/\b[\w'-]+\b/g) || [];
  if (words.length > (brief.wordBudget ?? 400))
    copy.push(`Word budget: ${words.length} > ${brief.wordBudget ?? 400}`);
  for (const para of prose(md).split(/\n\s*\n/))
    if ((para.match(/[.!?。！？](?:\s|$)/g) || []).length > 3)
      copy.push("Paragraph exceeds three sentences");
  if (
    (md.match(/!\[[^\]]*\]\([^)]*(?:badge|shields\.io|badgen)[^)]*\)/gi) || [])
      .length > 4
  )
    copy.push("More than four badges");
  if (headings(md).some((h) => /\p{Extended_Pictographic}/u.test(h.text)))
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
  if (!zh)
    checks.push({
      id: "V7",
      status: brief.languages?.includes("zh-CN") ? "fail" : "skip",
      reason: "Chinese README absent",
      issues: brief.languages?.includes("zh-CN")
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
    const aKeys = keys(md),
      bKeys = keys(zh);
    if (
      aKeys.some(
        (a, i) => a[1] >= 0 && bKeys[i]?.[1] >= 0 && a[1] !== bKeys[i][1],
      )
    )
      issues.push("Translated heading order differs");
    if (
      JSON.stringify(headings(md).map((h) => h.depth)) !==
      JSON.stringify(headings(zh).map((h) => h.depth))
    )
      issues.push("Heading structure/order differs");
    if (
      JSON.stringify(shellBlocks(md).map((b) => b.code)) !==
      JSON.stringify(shellBlocks(zh).map((b) => b.code))
    )
      issues.push("Shell blocks differ");
    const norm = (s) =>
      images(s).map((i) => i.src?.replace(/\.zh-CN(?=\.)/g, ""));
    if (JSON.stringify(norm(md)) !== JSON.stringify(norm(zh)))
      issues.push("Image sequence differs");
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
    screen = await firstScreen({ ...opts, install: brief.install?.command });
    checks.unshift(
      check(
        "V2",
        Object.entries(screen.viewports.desktop.checks)
          .filter(([, v]) => !v)
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
  return `# ${title}\n\nScore: ${result.score}/100\n\n| Check | Result | Evidence |\n|---|---|---|\n${result.checks.map((c) => `| ${c.id} | ${c.status} | ${(c.issues?.join("; ") || c.reason || "Passed").replace(/\|/g, "\\|")} |`).join("\n")}\n\n${result.checks.find((c) => c.id === "V2")?.screen?.renderer || "No screen renderer"}\n`;
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
  for (const file of [
    "README.md",
    ...((await exists(path.join(opts.repo, "README.zh-CN.md")))
      ? ["README.zh-CN.md"]
      : []),
  ])
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
      });
      commandResults.push({
        ...b,
        file,
        ...run,
        status:
          !run.timedOut && run.exitCode === (rule.expectExit ?? 0)
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
      { results: commandResults },
    ),
  );
  if (!facts.testCommands.length)
    checks.push({
      id: "V8",
      status: "skip",
      reason: "No test command discovered",
      issues: [],
    });
  else {
    const results = [];
    for (const cmd of facts.testCommands)
      results.push(await runCopy(opts.repo, cmd));
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
        ].some((k) => f.checks[k] !== "pass")
      )
        artIssues.push(`Failed or absent self-check ${f.file}`);
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
