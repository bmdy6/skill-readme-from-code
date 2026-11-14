import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tidyBaseline, verifyTidy } from "../scripts/lib/tidy.mjs";
const original =
  "# Demo\n\nA useful tool.\n\n## Install\n\n```sh\nnpm ci\n```\n\n## Guide\n\nKeep this paragraph.\n\n[Docs](https://example.com/docs)\n";
async function fixture(t, before = { "README.md": original }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tidy-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo"),
    work = path.join(dir, "work");
  await fs.mkdir(repo);
  for (const [file, text] of Object.entries(before))
    await fs.writeFile(path.join(repo, file), text);
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], {
      stdio: "pipe",
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "baseline",
  );
  await tidyBaseline({ repo, work });
  await fs.writeFile(path.join(work, "tidy.json"), "{}");
  return { repo, work, local: true, offline: true };
}
async function verify(o, text, spec = {}) {
  await fs.writeFile(path.join(o.repo, "README.md"), text);
  await fs.writeFile(path.join(o.work, "tidy.json"), JSON.stringify(spec));
  return verifyTidy(o);
}
const status = (r, id) => r.checks.find((c) => c.id === id).status;
test("two H2 sections can swap with an empty manifest", async (t) => {
  const o = await fixture(t),
    cut = original.indexOf("## Guide");
  const r = await verify(
    o,
    original.slice(0, original.indexOf("## Install")) +
      original.slice(cut) +
      "\n" +
      original.slice(original.indexOf("## Install"), cut),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  await fs.access(path.join(o.work, "tidy-report.md"));
  await fs.access(path.join(o.work, "tidy-report.json"));
});
for (const [id, edit, spec] of [
  ["T2", (s) => s.replace("Keep this paragraph.\n", "")],
  ["T4", (s) => s.replace("npm ci", "npm install")],
  ["T3", (s) => s + "\nUnregistered new prose.\n"],
  [
    "T6",
    (s) => s.replace("A useful tool.", "A useful tool.\n\n[Guide](#wrong)"),
    {
      added: [
        {
          readme: "README.md",
          text: "[Guide](#wrong)",
          kind: "navigation",
          reason: "Add navigation",
        },
      ],
    },
  ],
  ["T5", (s) => s.replace("[Docs](https://example.com/docs)", "Docs")],
  ["T7", (s) => s + "\n本轮已完成验证。\n"],
  ["T1", (s) => s.replace("## Guide", "## Usage")],
  [
    "T8",
    (s) => s.replace("## Install", "<br>\n".repeat(70) + "## Install"),
    {
      added: [
        {
          readme: "README.md",
          text: "<br>",
          kind: "details",
          reason: "Not valid details",
        },
      ],
    },
  ],
])
  test(`rejects ${id} counterexample`, async (t) =>
    assert.equal(
      status(await verify(await fixture(t), edit(original), spec), id),
      "fail",
    ));
test("registrations need reasons; code edits cannot be waived", async (t) => {
  const o = await fixture(t);
  let r = await verify(o, original.replace("Keep this paragraph.", ""), {
    removed: [{ readme: "README.md", before: "Keep this paragraph." }],
  });
  assert.equal(status(r, "T2"), "fail");
  r = await verify(o, original.replace("npm ci", "npm install"), {
    rewritten: [
      {
        readme: "README.md",
        before: "npm ci",
        after: "npm install",
        reason: "Change command",
      },
    ],
  });
  assert.equal(status(r, "T4"), "fail");
});
test("checks each README language independently including other locales", async (t) => {
  const o = await fixture(t, {
    "README.md": original,
    "README.fr.md": original,
  });
  await fs.writeFile(
    path.join(o.repo, "README.fr.md"),
    original.replace("Keep this paragraph.", ""),
  );
  const r = await verifyTidy(o);
  assert.equal(status(r, "T2"), "fail");
  assert.match(JSON.stringify(r), /README.fr.md/);
});
test("baseline is immutable, refuses dirty README and verifies blob reference", async (t) => {
  const o = await fixture(t);
  await assert.rejects(() => tidyBaseline(o), /exists/);
  const p = path.join(o.work, "tidy-baseline.json"),
    b = JSON.parse(await fs.readFile(p));
  assert.equal(b.readmes[0].text, undefined);
  b.readmes[0].blob = "0".repeat(40);
  await fs.writeFile(p, JSON.stringify(b));
  await assert.rejects(() => verifyTidy(o), /baseline/i);
  await fs.rm(p);
  await fs.appendFile(path.join(o.repo, "README.md"), "dirty");
  await assert.rejects(() => tidyBaseline(o), /committed/);
});
for (const name of ["jingwei", "footage-mcp", "stylepolish", "repo-tutor"])
  test(`real merged fixture: ${name}`, async (t) => {
    const root = new URL(`./fixtures/tidy/${name}/`, import.meta.url),
      source = JSON.parse(await fs.readFile(new URL("source.json", root)));
    for (const label of ["before", "after"])
      for (const file of source.files) {
        const bytes = await fs.readFile(new URL(`${label}/${file}`, root));
        const blob = createHash("sha1")
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest("hex");
        assert.equal(
          blob,
          source.blobs[label][file],
          `${name}/${label}/${file}: preserve real git blob`,
        );
      }
    const before = {};
    for (const f of source.files)
      before[f] = await fs.readFile(new URL(`before/${f}`, root), "utf8");
    const o = await fixture(t, before);
    for (const f of source.files)
      await fs.copyFile(new URL(`after/${f}`, root), path.join(o.repo, f));
    await fs.copyFile(
      new URL("tidy.json", root),
      path.join(o.work, "tidy.json"),
    );
    const r = await verifyTidy(o);
    if (name === "repo-tutor") {
      assert.equal(r.ok, false);
      assert.deepEqual(
        r.checks.filter((c) => c.status === "fail").map((c) => c.id),
        ["T7"],
      );
      assert.match(
        JSON.stringify(r.checks.find((c) => c.id === "T7")),
        /Work-log wording/,
      );
    } else assert.equal(r.ok, true, JSON.stringify(r));
    if (process.env.TIDY_REPORT_DIR) {
      await fs.mkdir(path.join(process.env.TIDY_REPORT_DIR, name), {
        recursive: true,
      });
      for (const f of ["tidy-report.md", "tidy-report.json"])
        await fs.copyFile(
          path.join(o.work, f),
          path.join(process.env.TIDY_REPORT_DIR, name, f),
        );
    }
  });
test("allows registered heading rename, deletion, details and link removal", async (t) => {
  const o = await fixture(t);
  const r = await verify(
    o,
    original
      .replace("## Guide", "## Usage")
      .replace(
        "Keep this paragraph.",
        "<details>\n<summary>More</summary>\n\n</details>",
      )
      .replace("[Docs](https://example.com/docs)", ""),
    {
      renamedHeadings: [
        {
          readme: "README.md",
          before: "Guide",
          after: "Usage",
          reason: "Shorter title",
        },
      ],
      removed: [
        {
          readme: "README.md",
          before: "Keep this paragraph.",
          after: "",
          reason: "Remove redundant copy",
        },
        {
          readme: "README.md",
          before: "[Docs](https://example.com/docs)",
          after: "",
          reason: "Remove obsolete docs",
        },
      ],
      added: ["<details>", "<summary>More</summary>", "</details>"].map(
        (text) => ({
          readme: "README.md",
          text,
          kind: "details",
          reason: "Fold prose",
        }),
      ),
    },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});
test("registration in added cannot authorize arbitrary prose", async (t) => {
  const o = await fixture(t);
  const r = await verify(o, original + "\nNew marketing paragraph.\n", {
    added: [
      {
        readme: "README.md",
        text: "New marketing paragraph.",
        kind: "prose",
        reason: "Try bypass",
      },
    ],
  });
  assert.equal(status(r, "T3"), "fail");
});
test("T4 checks non-shell fences and duplicate block counts", async (t) => {
  const before = original + '\n```json\n{"secret": false}\n```\n',
    o = await fixture(t, { "README.md": before });
  assert.equal(
    status(await verify(o, before.replace("false", "true")), "T4"),
    "fail",
  );
  assert.equal(
    status(await verify(o, before + "\n```sh\nnpm ci\n```\n"), "T4"),
    "fail",
  );
});
test("pre-existing below-fold installation warns; documented images are not silently lost", async (t) => {
  const text =
    original.replace(
      "## Install",
      "Long paragraph.\n\n".repeat(50) + "## Install",
    ) + "\n![Demo](demo.png)\n";
  const o = await fixture(t, { "README.md": text });
  let r = await verifyTidy(o);
  assert.equal(r.ok, true);
  assert.ok(r.checks.find((c) => c.id === "T8").warnings.length);
  r = await verify(o, text.replace("![Demo](demo.png)", ""), {
    removed: [
      {
        readme: "README.md",
        before: "![Demo](demo.png)",
        after: "",
        reason: "Remove retired image",
      },
    ],
  });
  assert.equal(status(r, "T5"), "pass");
});
test("CLI writes reports and uses distinct exit codes", async (t) => {
  const o = await fixture(t),
    cli = fileURLToPath(new URL("../scripts/run.mjs", import.meta.url));
  const args = [
    cli,
    "tidy",
    "verify",
    "--repo",
    o.repo,
    "--work",
    o.work,
    "--local",
    "--offline",
  ];
  execFileSync(process.execPath, args, { stdio: "pipe" });
  await fs.appendFile(path.join(o.repo, "README.md"), "\nUnexpected prose.\n");
  assert.throws(
    () => execFileSync(process.execPath, args, { stdio: "pipe" }),
    (e) => e.status === 1,
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [cli, "tidy", "oops", "--repo", o.repo, "--work", o.work],
        { stdio: "pipe" },
      ),
    (e) => e.status === 2,
  );
});
test("sentence rewrites inside a paragraph replay without waiving unrelated text", async (t) => {
  const text = original.replace(
      "Keep this paragraph.",
      "Keep this paragraph. This round we tested it.",
    ),
    o = await fixture(t, { "README.md": text });
  const spec = {
    rewritten: [
      {
        readme: "README.md",
        before: "This round we tested it.",
        after: "Tested locally.",
        reason: "Remove work-log language",
      },
    ],
  };
  let r = await verify(
    o,
    text.replace("This round we tested it.", "Tested locally."),
    spec,
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  r = await verify(
    o,
    text.replace(
      "Keep this paragraph. This round we tested it.",
      "Tested locally.",
    ),
    spec,
  );
  assert.equal(status(r, "T2"), "fail");
});
test("retaining baseline work-log wording and pre-title prose fails T7", async (t) => {
  const text = "Unplaced slogan.\n\n" + original + "\n本轮测试通过。\n",
    o = await fixture(t, { "README.md": text });
  const r = await verifyTidy(o);
  assert.equal(status(r, "T7"), "fail");
  assert.match(JSON.stringify(r), /Text before the title/);
});
test("added navigation accepts encoded and explicit HTML anchors", async (t) => {
  const text = original + '\n<a id="extra"></a>\n',
    o = await fixture(t, { "README.md": text });
  const nav = "[Guide](#guide) · [Extra](#%65xtra)";
  const r = await verify(
    o,
    text.replace("A useful tool.", "A useful tool.\n\n" + nav),
    {
      added: [
        {
          readme: "README.md",
          kind: "navigation",
          text: nav,
          reason: "Navigate sections",
        },
      ],
    },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
});
