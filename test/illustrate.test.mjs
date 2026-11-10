import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  illustrateBaseline,
  verifyIllustrate,
} from "../scripts/lib/illustrate.mjs";
const original =
  "# Demo\n\nReadable description.\n\n## Install\n\n```sh\nnpm ci\n```\n";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "illustrate-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo"),
    work = path.join(dir, "work");
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, "README.md"), original);
  await illustrateBaseline({ repo, work });
  await fs.writeFile(
    path.join(work, "brief.json"),
    JSON.stringify({ install: { block: "npm ci" } }),
  );
  return { repo, work };
}
test("illustrate accepts unchanged original plus a sourced illustration; no blind/V9/V10 gates", async (t) => {
  const o = await fixture(t);
  await fs.writeFile(
    path.join(o.repo, "flow.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"><text x="10" y="30">Mention → answer</text></svg>',
  );
  const block =
    '<!-- readme-illustrate:flow -->\n<img src="flow.svg" alt="Group flow">\n\nIllustration: mention to answer.\n<!-- /readme-illustrate:flow -->\n';
  await fs.writeFile(path.join(o.repo, "README.md"), original + block);
  const manifest = {
    images: [
      {
        id: "flow",
        readme: "README.md",
        file: "flow.svg",
        alt: "Group flow",
        caption: "Illustration: mention to answer.",
        source: {
          kind: "illustration",
          command: "node draw.mjs",
          data: "original synthetic flow",
        },
      },
    ],
  };
  await fs.writeFile(
    path.join(o.work, "illustrate.json"),
    JSON.stringify(manifest),
  );
  const result = await verifyIllustrate({ ...o, local: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  await fs.writeFile(
    path.join(o.repo, "README.md"),
    (original + block).replace("npm ci", "npm install"),
  );
  const changed = await verifyIllustrate({ ...o, local: true });
  assert.equal(changed.ok, false);
  assert.ok(
    changed.checks.some((c) => c.id === "preservation" && c.status === "fail"),
  );
});
test("baseline is immutable and missing sources/images cannot pass", async (t) => {
  const o = await fixture(t);
  await assert.rejects(() => illustrateBaseline(o), /exists/);
  await fs.writeFile(
    path.join(o.work, "illustrate.json"),
    JSON.stringify({
      images: [{ id: "nope", readme: "README.md", file: "missing.png" }],
    }),
  );
  const r = await verifyIllustrate({ ...o, local: true });
  assert.equal(r.ok, false);
});
test("a README whose install is below fold fails honestly", async (t) => {
  const o = await fixture(t);
  await fs.writeFile(
    path.join(o.repo, "README.md"),
    original.replace(
      "## Install",
      "Long paragraph.\n\n".repeat(60) + "## Install",
    ),
  );
  await fs.writeFile(path.join(o.work, "illustrate.json"), '{"images":[]}');
  const r = await verifyIllustrate({ ...o, local: true });
  assert.equal(r.ok, false);
  assert.ok(
    r.checks.some((c) => c.id === "first-screen" && c.status === "fail"),
  );
});

test("requires an explicit installation block, not an arbitrary first demo command", async (t) => {
  const o = await fixture(t);
  await fs.writeFile(path.join(o.work, "brief.json"), "{}");
  await fs.writeFile(path.join(o.work, "illustrate.json"), '{"images":[]}');
  await assert.rejects(
    () => verifyIllustrate({ ...o, local: true }),
    /install/,
  );
});
test("checks declared hash, byte limit, dimensions and path containment", async (t) => {
  const o = await fixture(t);
  const { illustrationBlock } = await import("../scripts/lib/illustrate.mjs");
  const i = {
    id: "check",
    readme: "README.md",
    file: "check.svg",
    alt: "Check image",
    caption: "Illustration: original flow.",
    source: {
      kind: "illustration",
      command: "node draw.mjs",
      data: "Original diagram",
      sha256: "wrong",
    },
  };
  await fs.writeFile(
    path.join(o.repo, i.file),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"/>',
  );
  await fs.writeFile(
    path.join(o.repo, "README.md"),
    original + illustrationBlock(i),
  );
  const verify = async () => {
    await fs.writeFile(
      path.join(o.work, "illustrate.json"),
      JSON.stringify({ images: [i] }),
    );
    return verifyIllustrate({ ...o, local: true });
  };
  assert.match(JSON.stringify((await verify()).checks), /hash mismatch/);
  delete i.source.sha256;
  await fs.writeFile(path.join(o.repo, i.file), "x".repeat(400000));
  assert.match(JSON.stringify((await verify()).checks), /<400KB/);
  await fs.writeFile(
    path.join(o.repo, i.file),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
  );
  assert.match(JSON.stringify((await verify()).checks), /dimensions/);
  await fs.rm(path.join(o.repo, i.file));
  await fs.symlink("/etc/hosts", path.join(o.repo, i.file));
  assert.match(JSON.stringify((await verify()).checks), /escapes repository/);
});
