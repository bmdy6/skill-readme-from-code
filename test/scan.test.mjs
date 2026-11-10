import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../scripts/lib/scan.mjs";
for (const type of ["cli-tool", "library", "web-app", "agent-skill", "clean"]) {
  test(`scan ${type} is deterministic and sourced`, async () => {
    const a = await scan(`evals/fixtures/${type}`, { github: false });
    assert.deepEqual(
      a,
      await scan(`evals/fixtures/${type}`, { github: false }),
    );
    assert.equal(
      a.projectType,
      type === "cli-tool" ? "cli" : type === "clean" ? "library" : type,
    );
    assert.ok(a.facts.length > 2);
    for (const f of a.facts) assert.match(f.source, /:\d+$/);
  });
}
test("detects tests locking README", async () => {
  const a = await scan("evals/fixtures/agent-skill", { github: false });
  assert.equal(a.readmeTests.length, 1);
});

test("SwiftPM scan reports the manifest and Swift test without guessing installation", async (t) => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-swiftpm-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/demo/example.git"]);
  assert.equal((await scan(repo, { github: false })).install, null);
  await fs.writeFile(path.join(repo, "Package.swift"), '// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "Example", targets: [.testTarget(name: "ExampleTests")])\n');
  const result = await scan(repo, { github: false });
  assert.equal(result.buildSystem, "swiftpm");
  assert.equal(result.install, null);
  assert.deepEqual(result.testCommands, ["swift test"]);
  assert.equal(result.facts.find((f) => f.id === "swift-test")?.source, "Package.swift:3");
  await fs.writeFile(path.join(repo, "SKILL.md"), "# Example");
  assert.equal((await scan(repo, { github: false })).install, "npx skills add demo/example");
});
