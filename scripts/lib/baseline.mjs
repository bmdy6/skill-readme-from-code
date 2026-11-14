import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readmeDocuments } from "./io.mjs";
export const git = (repo, args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
export async function freezeBaseline(o, file, documents = readmeDocuments) {
  const commit = git(o.repo, ["rev-parse", "HEAD"]).trim();
  const readmes = [];
  for (const d of await documents(o.repo)) {
    const blob = git(o.repo, ["rev-parse", `${commit}:${d.file}`]).trim();
    if (git(o.repo, ["show", `${commit}:${d.file}`]) !== d.text)
      throw Error(`README must be committed before baseline: ${d.file}`);
    readmes.push({ file: d.file, blob });
  }
  const baseline = { version: 2, commit, readmes };
  await fs.mkdir(o.work, { recursive: true });
  await fs.writeFile(file, JSON.stringify(baseline, null, 2) + "\n", {
    flag: "wx",
  });
  return baseline;
}
