import path from "node:path";
import { execFileSync } from "node:child_process";
import { files, read, json } from "./io.mjs";
import { headings } from "./markdown.mjs";
export function gitRepo(repo) {
  try {
    return (
      execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .replace(/\.git$/, "")
        .match(/[:/]([^/:]+\/[^/]+)$/)?.[1] || null
    );
  } catch {
    return null;
  }
}
export async function scan(repo, { github = true } = {}) {
  repo = path.resolve(repo);
  const list = await files(repo),
    facts = [];
  const add = (id, claim, value, file, needle = "") =>
    facts.push({
      id,
      claim,
      value,
      source: `${file}:${Math.max(1, (texts[file] || "").split("\n").findIndex((l) => l.includes(needle)) + 1)}`,
    });
  const texts = {};
  for (const f of list.filter((f) =>
    /\.(json|mjs|js|ts|md|ya?ml|toml)$|(^|\/)LICENSE/.test(f),
  ))
    texts[f] = await read(path.join(repo, f));
  const manifest = await json(path.join(repo, "package.json"), {});
  const projectType = list.includes("SKILL.md")
    ? "agent-skill"
    : manifest.bin
      ? "cli"
      : manifest.scripts?.dev ||
          manifest.dependencies?.react ||
          list.includes("index.html")
        ? "web-app"
        : manifest.main || manifest.exports
          ? "library"
          : "other";
  add(
    "project-type",
    "Project type",
    projectType,
    list.includes("SKILL.md")
      ? "SKILL.md"
      : list.includes("package.json")
        ? "package.json"
        : list[0] || "README.md",
  );
  if (list.includes("package.json"))
    for (const k of [
      "name",
      "version",
      "description",
      "license",
      "bin",
      "main",
      "exports",
      "engines",
      "dependencies",
      "devDependencies",
      "scripts",
    ])
      if (manifest[k])
        add(
          `manifest-${k}`,
          `Manifest ${k}`,
          manifest[k],
          "package.json",
          `"${k}"`,
        );
  const licenseFile = list.find((f) => /^LICENSE(?:\..+)?$/i.test(f));
  const licenseText = licenseFile
    ? await read(path.join(repo, licenseFile))
    : "";
  const spdx = /MIT License/.test(licenseText)
    ? "MIT"
    : /Apache License[\s\S]*Version 2\.0/.test(licenseText)
      ? "Apache-2.0"
      : /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/.test(licenseText)
        ? "GPL-3.0-only"
        : /BSD 3-Clause/.test(licenseText)
          ? "BSD-3-Clause"
          : null;
  if (licenseFile) add("license", "License SPDX", spdx, licenseFile);
  const workflows = list.filter((f) =>
    /^\.github\/workflows\/.*\.ya?ml$/.test(f),
  );
  for (const [i, f] of workflows.entries()) add(`ci-${i}`, "CI workflow", f, f);
  const readmeTests = list.filter(
    (f) =>
      /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./.test(f) &&
      /README(?:\.zh-CN)?\.md/.test(texts[f] || ""),
  );
  for (const [i, f] of readmeTests.entries())
    add(`readme-test-${i}`, "Test constrains README", f, f, "README");
  const entries = list.filter((f) =>
    /^(SKILL\.md|scripts\/run\.mjs|src\/index\.[jt]s|index\.[jm]s)$/.test(f),
  );
  for (const [i, f] of entries.entries())
    add(`entry-${i}`, "Entry point", f, f);
  const images = list.filter((f) => /\.(png|svg|jpe?g|webp)$/i.test(f));
  for (const [i, f] of images.entries())
    add(`image-${i}`, "Existing image", f, f);
  const testCommands = manifest.scripts?.test ? ["npm test"] : [];
  const remote = gitRepo(repo);
  let metadata = null;
  if (github && remote) {
    try {
      const data = JSON.parse(
        execFileSync("gh", ["api", `repos/${remote}`], {
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
      metadata = { about: data.description, topics: data.topics || [] };
    } catch {
      /* Optional network metadata is not a code fact. */
    }
  }
  const integrations = [];
  const toolNames = [
    "Claude Code",
    "Codex",
    "Cursor",
    "pi",
    "DeepSeek Harness",
    "OpenCode",
    "Gemini CLI",
    "ChatGPT",
    "Google Antigravity",
    "Python",
    "Node",
    "Chromium",
    "gh",
    "JSONL",
    "JSON",
  ];
  const readmes = [];
  for (const file of ["README.md", "README.zh-CN.md"])
    if (texts[file]) {
      readmes.push({
        file,
        headings: headings(texts[file])
          .filter((h) => h.depth === 2)
          .map((h) => h.text),
      });
      for (const name of toolNames) {
        const rx = new RegExp(
          `(?<![\\p{L}\\p{N}_])${name}(?![\\p{L}\\p{N}_])`,
          "iu",
        );
        const mention = rx.exec(texts[file]);
        if (mention) {
          const id = `integration-${file === "README.md" ? "en" : "zh"}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          add(
            id,
            "Tool, platform or runtime mentioned in the README",
            name,
            file,
            mention[0],
          );
          facts.at(-1).kind = "integration";
          integrations.push({ ...facts.at(-1), readme: file });
        }
      }
    }
  const alternativeTerms = await json(
    path.join(repo, "readme-competitors.json"),
    [],
  );
  for (const [i, name] of alternativeTerms.entries()) {
    add(
      `alternative-${i}`,
      "Named alternative",
      name,
      "readme-competitors.json",
      name,
    );
    facts.at(-1).kind = "alternative";
  }
  const install =
    manifest.name && !manifest.private
      ? `npm install ${manifest.name}`
      : remote
        ? `npx skills add ${remote}`
        : null;
  return {
    schemaVersion: 1,
    projectType,
    manifest,
    install,
    entries,
    testCommands,
    spdx,
    workflows,
    images,
    readmeTests,
    remote,
    metadata,
    competitorTerms: alternativeTerms,
    readmeSnapshot: { readmes, integrations },
    facts,
  };
}
