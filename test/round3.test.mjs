import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { write } from "../scripts/lib/io.mjs";
import { heroRelevance } from "../scripts/lib/evidence.mjs";

const brief = {
  coreAction: {
    what: "Create a digest",
    input: "notes",
    command: "node index.mjs",
    output: { keywords: ["digest"] },
    factIds: ["entry"],
  },
};
async function fixture() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-score-caption-"));
  await write(path.join(repo, "docs/readme/art.json"), {
    images: [
      {
        id: "hero",
        template: "hero-terminal",
        captureId: "core",
        stats: ["summary.pass"],
      },
    ],
  });
  await write(path.join(repo, "docs/readme/captures/core.json"), {
    role: "core",
    command: "node index.mjs",
    stdout: "Digest written",
  });
  return repo;
}
const image =
  '<picture><img src="docs/readme/hero-light.png" alt="Digest result"></picture>';
test("F2 V10 rejects a scored hero without a calculation in its caption", async () => {
  const repo = await fixture();
  await write(
    path.join(repo, "README.md"),
    `# Moss\n\n${image}\n\nA good result.\n\n## FAQ\n\nScore = share of README checks passed.\n`,
  );
  const r = await heroRelevance(repo, brief);
  assert.equal(r.status, "fail");
  assert.match(r.issues.join(" "), /score.*caption/i);
});
test("F2 V10 accepts an immediate calculation caption and checks Chinese too", async () => {
  const repo = await fixture();
  await write(
    path.join(repo, "README.md"),
    `# Moss\n\n${image}\n\nAudit score = share of README checks passed.\n`,
  );
  assert.equal((await heroRelevance(repo, brief)).status, "pass");
  await write(
    path.join(repo, "README.zh-CN.md"),
    `# Moss\n\n${image}\n\n真实效果。\n`,
  );
  assert.equal((await heroRelevance(repo, brief)).status, "fail");
  await write(
    path.join(repo, "README.zh-CN.md"),
    `# Moss\n\n${image}\n\n审计分 = README 检查通过项占比。\n`,
  );
  assert.equal((await heroRelevance(repo, brief)).status, "pass");
});
test("F2 V10 keeps score-free heroes valid", async () => {
  const repo = await fixture();
  const p = path.join(repo, "docs/readme/art.json");
  const spec = JSON.parse(await fs.readFile(p, "utf8"));
  delete spec.images[0].stats;
  await write(p, spec);
  await write(
    path.join(repo, "README.md"),
    `# Moss\n\n${image}\n\nActual digest output.\n`,
  );
  assert.equal((await heroRelevance(repo, brief)).status, "pass");
});
test("F2 V10 also detects a score printed directly by the core command", async () => {
  const repo = await fixture();
  const spec = {
    images: [{ id: "hero", template: "hero-terminal", captureId: "core" }],
  };
  await write(path.join(repo, "docs/readme/art.json"), spec);
  await write(path.join(repo, "docs/readme/captures/core.json"), {
    role: "core",
    command: "node index.mjs",
    stdout: "Digest quality: 80/100",
  });
  await write(
    path.join(repo, "README.md"),
    `# Moss\n\n${image}\n\nActual output.\n`,
  );
  const r = await heroRelevance(repo, brief);
  assert.equal(r.status, "fail");
  assert.match(r.issues.join(" "), /score.*caption/i);
});
