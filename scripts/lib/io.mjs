import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { leadText } from "./markdown.mjs";
export const exists = async (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );
export const read = async (p, fallback = "") =>
  fs.readFile(p, "utf8").catch((e) => {
    if (e.code === "ENOENT") return fallback;
    throw e;
  });
export async function json(p, fallback = null) {
  const s = await read(p);
  return s ? JSON.parse(s) : fallback;
}
export async function write(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(
    p,
    typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
  );
}
export const hash = (b) => createHash("sha256").update(b).digest("hex");
export const workdir = (repo) =>
  path.join(
    os.homedir(),
    ".cache/readme-from-code",
    path.basename(path.resolve(repo)),
  );
export async function files(root, dir = "") {
  const out = [];
  for (const e of (
    await fs.readdir(path.join(root, dir), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (
      [".git", "node_modules", ".cache", ".env", ".DS_Store", ".npmrc", ".netrc", ".pypirc", ".ssh", ".aws", ".build", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"].includes(
        e.name,
      ) ||
      (e.name.startsWith(".env.") && !(e.name === ".env.example" && tracked(root, path.posix.join(dir, e.name))))
    )
      continue;
    const p = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(root, p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function tracked(root, file) {
  try {
    execFileSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", file], {stdio: "ignore"});
    return true;
  } catch { return false; }
}

export function checkEvidence(c) {
  return [...(c.issues || []), ...(c.reason ? [c.reason] : []), ...(c.warnings || [])].join("; ") || "Passed";
}
export async function readmeDocuments(repo, brief = {}) {
  const explicit = brief.readmes || {};
  const names = [...new Set(["README.md", "README.en.md", "README.zh-CN.md", ...Object.keys(explicit)])];
  const result = [];
  for (const file of names) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..") || !/^README(?:[.\w-]*)\.md$/.test(file))
      throw Error("Invalid README filename: " + file);
    if (!(await exists(path.join(repo, file)))) {
      if (explicit[file]) throw Error("Declared README missing: " + file);
      continue;
    }
    const text = await read(path.join(repo, file));
    const language = explicit[file] || (file === "README.zh-CN.md" ? "zh-CN" : file === "README.en.md" ? "en" : /\p{Script=Han}/u.test(leadText(text) || "") ? "zh-CN" : "en");
    if (!["en", "zh-CN"].includes(language)) throw Error("Unsupported README language: " + language);
    result.push({file, text, language});
  }
  return result;
}
export function installationBlock(install) {
  return typeof install === "string" ? install : install?.block ?? install?.command;
}
export function installationFirstCommand(install) {
  const first = installationBlock(install)?.trim().split(/\r?\n/)[0];
  if (install?.firstCommand !== undefined && install.firstCommand.trim().replace(/\s+/g, " ") !== first?.trim().replace(/\s+/g, " "))
    throw Error("install.firstCommand must equal the first line of install.block");
  return install?.firstCommand ?? first;
}
