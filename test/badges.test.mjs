import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scan } from "../scripts/lib/scan.mjs";
import { retentionCheck } from "../scripts/lib/evidence.mjs";
import { write, json } from "../scripts/lib/io.mjs";
const ci =
  "[![CI](https://github.com/acme/moss/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/moss/actions)";
const node =
  '<a href="https://nodejs.org"><img alt="Node >=20" src="https://img.shields.io/badge/node-%3E%3D20-green"></a>';
const md = `# Moss\n\nTurn notes into digests.\n\n${ci}\n${node}\n\n![Example](demo.png)\n\nRequires Node.\n`;
async function fixture(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-badges-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await write(path.join(repo, "README.md"), md);
  return repo;
}
test("scan and first baseline snapshot every real badge with stable IDs and sources", async (t) => {
  const repo = await fixture(t),
    work = path.join(repo, "work");
  const r = await scan(repo, { github: false });
  assert.equal(r.readmeSnapshot.badges?.length, 2);
  assert.deepEqual(
    r.readmeSnapshot.badges,
    (await scan(repo, { github: false })).readmeSnapshot.badges,
  );
  for (const b of r.readmeSnapshot.badges) {
    assert.ok(b.id && b.src && b.href);
    assert.match(b.source, /^README.md:\d+$/);
    assert.ok(r.facts.some((f) => f.id === b.id && f.kind === "badge"));
  }
  execFileSync(process.execPath, [
    "scripts/run.mjs",
    "scan",
    "--repo",
    repo,
    "--work",
    work,
  ]);
  const baseline = await json(path.join(work, "baseline.json"));
  assert.deepEqual(baseline.badges, r.readmeSnapshot.badges);
  await write(path.join(repo, "README.md"), "# Moss\n");
  execFileSync(process.execPath, [
    "scripts/run.mjs",
    "scan",
    "--repo",
    repo,
    "--work",
    work,
  ]);
  assert.deepEqual(
    (await json(path.join(work, "baseline.json"))).badges,
    baseline.badges,
  );
});
test("V11 fails each omitted badge without a specific reason, passes retained or reasoned deletion", async (t) => {
  const repo = await fixture(t);
  const baseline = (await scan(repo, { github: false })).readmeSnapshot;
  assert.equal(baseline.badges?.length, 2);
  await write(path.join(repo, "docs/readme/baseline.json"), baseline);
  assert.equal((await retentionCheck(repo)).status, "pass");
  await write(
    path.join(repo, "README.md"),
    md.replace(ci, "").replace(node, ""),
  );
  let r = await retentionCheck(repo);
  assert.equal(r.status, "fail");
  assert.equal(r.issues.filter((s) => /badge/i.test(s)).length, 2);
  await write(path.join(repo, "docs/readme/retention.json"), {
    intentionalDeletions: baseline.badges.map((b) => ({
      id: b.id,
      reason: " ",
    })),
  });
  assert.equal((await retentionCheck(repo)).status, "fail");
  await write(path.join(repo, "docs/readme/retention.json"), {
    intentionalDeletions: baseline.badges.map((b) => ({
      id: b.id,
      reason:
        "The linked status endpoint no longer exists (checked 2026-11-08).",
    })),
  });
  r = await retentionCheck(repo);
  assert.equal(r.status, "pass");
  assert.equal(r.intentionalDeletions.length, 2);
});
test("V11 does not count a plain URL, code example, moved badge or changed target as retained", async (t) => {
  const repo = await fixture(t);
  await write(
    path.join(repo, "docs/readme/baseline.json"),
    (await scan(repo, { github: false })).readmeSnapshot,
  );
  await write(path.join(repo, "docs/badges.md"), ci);
  for (const replacement of [
    "https://github.com/acme/moss/actions/workflows/ci.yml/badge.svg",
    `\`\`\`md\n${ci}\n\`\`\``,
    "[Badges](docs/badges.md)",
    ci.replace(
      "](https://github.com/acme/moss/actions)",
      "](https://example.com)",
    ),
  ]) {
    await write(path.join(repo, "README.md"), md.replace(ci, replacement));
    assert.equal((await retentionCheck(repo)).status, "fail", replacement);
  }
});

test("reference/HTML badges, locales and repeated badges are accounted independently", async (t) => {
  const repo = await fixture(t);
  const text =
    '# Moss\n\n[![CI][image]][target]\n\n[image]: https://example.com/badge.svg\n[target]: https://example.com/status\n\n<img src="badge-local.svg" alt="License">\n\n' +
    ci +
    "\n\n" +
    ci;
  await write(path.join(repo, "README.md"), text);
  await write(path.join(repo, "README.zh-CN.md"), text);
  const baseline = (await scan(repo, { github: false })).readmeSnapshot;
  assert.equal(baseline.badges.length, 8);
  assert.equal(new Set(baseline.badges.map((b) => b.id)).size, 8);
  await write(path.join(repo, "docs/readme/baseline.json"), baseline);
  assert.equal((await retentionCheck(repo)).status, "pass");
  await write(path.join(repo, "README.zh-CN.md"), text.replace(ci, ""));
  const r = await retentionCheck(repo);
  assert.equal(r.status, "fail");
  assert.equal(r.issues.filter((s) => /badge/i.test(s)).length, 1);
});
