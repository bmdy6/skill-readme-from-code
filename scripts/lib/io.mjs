import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
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
      [".git", "node_modules", ".cache", ".env", ".DS_Store"].includes(
        e.name,
      ) ||
      e.name.startsWith(".env.")
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
