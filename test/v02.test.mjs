import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { staticChecks, verify } from "../scripts/lib/verify.mjs";
import { renderArt, inspectArt } from "../scripts/lib/art.mjs";
import { scoreAnswers } from "../scripts/lib/delivery.mjs";
import { firstScreen } from "../scripts/lib/screen.mjs";
import { heroRelevance } from "../scripts/lib/evidence.mjs";
import { capture } from "../scripts/lib/capture.mjs";
import { write, json, hash } from "../scripts/lib/io.mjs";
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "rfc-v02-"));
const facts = { facts: [], manifest: {}, images: [], workflows: [] };
async function copyCheck(text, brief = {}) {
  const repo = await tmp();
  await write(path.join(repo, "README.md"), text);
  return (await staticChecks(repo, facts, brief)).find((c) => c.id === "V6");
}
test("P1 supplied core artifact keywords replace the fallback; generic/absent artifact still fails", async () => {
  const brief = {
    coreAction: { output: { keywords: ["design tokens", "设计令牌"] } },
  };
  assert.equal(
    (
      await copyCheck(
        "# Juniper\n\nTurn CSS into design tokens for frontend developers.",
        brief,
      )
    ).status,
    "pass",
  );
  assert.match(
    (
      await copyCheck("# Juniper\n\nTurn ideas into amazing outcomes.", brief)
    ).issues.join(" "),
    /artifact/,
  );
  assert.match(
    (
      await copyCheck("# Juniper\n\nA tool that creates design tokens.", brief)
    ).issues.join(" "),
    /Generic/,
  );
});
test("P2 ordered/unordered items are paragraphs, but four-sentence items/real paragraphs fail", async () => {
  for (const mark of ["1.", "-"]) {
    assert.equal(
      (
        await copyCheck(
          "# Moss\n\nCreate a digest.\n\n" +
            [1, 2, 3].map((n) => `${mark} Step ${n}.`).join("\n"),
        )
      ).status,
      "pass",
    );
    assert.match(
      (
        await copyCheck(
          `# Moss\n\nCreate a digest.\n\n${mark} One. Two. Three. Four.`,
        )
      ).issues.join(" "),
      /three sentences/,
    );
  }
  assert.match(
    (
      await copyCheck("# Moss\n\nCreate a digest.\n\nOne. Two. Three. Four.")
    ).issues.join(" "),
    /three sentences/,
  );
});
test("P5 normalize English case, s/es/ies, hyphens and spaces without relaxing commands or Chinese", () => {
  const brief = {
    keyTerms: { what: ["design tokens"], audience: ["developers"] },
    install: { command: "npm i moss" },
    coreAction: { output: { keywords: ["source entries", "CSS classes"] } },
  };
  const a = {
    what: "DESIGN-TOKEN",
    forWhom: "developer",
    firstCommand: "npm i moss",
    wouldTry: "yes",
    whatOutput: "A source entry and CSS class",
  };
  assert.equal(scoreAnswers(brief, a).status, "pass");
  assert.equal(
    scoreAnswers(brief, { ...a, what: "notokenized" }).checks.what,
    false,
  );
  assert.equal(
    scoreAnswers(brief, { ...a, firstCommand: "NPM I MOSS" }).checks
      .firstCommand,
    false,
  );
  assert.equal(
    scoreAnswers(
      { ...brief, keyTerms: { what: ["令牌"], audience: ["开发者"] } },
      { ...a, what: "令 牌", forWhom: "开发者" },
    ).checks.what,
    false,
  );
});
test("P7 reference gives a typed supplemental fact with literal substring and line contract", async () => {
  const s = await fs.readFile("docs/reference.md", "utf8");
  assert.match(s, /value.{0,100}(?:nonempty string|non-empty string)/i);
  assert.match(s, /substring/);
  assert.match(s, /"source"\s*:\s*"[^"\n]+:\d+"/);
});
for (const kind of ["h2", "h3", "blockquote", "p"])
  test(`P8/P10 ${kind} lead and actual fold agree, offscreen remains fail`, async () => {
    const repo = await tmp(),
      work = await tmp();
    await write(
      path.join(repo, "README.md"),
      `# Moss\n\n<${kind}>Turn notes into a daily digest.</${kind}>\n\n<img src="hero.svg" width="600" alt="Digest">\n\n\`\`\`sh\nnpm i moss\n\`\`\``,
    );
    await write(
      path.join(repo, "hero.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><rect width="600" height="100" fill="green"/></svg>',
    );
    let r = await firstScreen({ repo, work, local: true });
    assert.ok(r.viewports.desktop.checks.oneLiner);
    assert.equal(r.viewports.desktop.fold, 800);
    await write(
      path.join(repo, "README.md"),
      `# Moss\n\n<div style="height:850px"></div>\n\n<${kind}>Turn notes into a daily digest.</${kind}>`,
    );
    r = await firstScreen({ repo, work, local: true });
    assert.equal(r.viewports.desktop.checks.oneLiner, false);
  });
test("P6/P11 project skip is explicit, custom tests run, expected stdout fails and interactive success warns", async () => {
  const repo = await tmp(),
    work = await tmp();
  await write(path.join(repo, "package.json"), {
    name: "moss",
    scripts: { test: "exit 99" },
  });
  await write(
    path.join(repo, "README.md"),
    '# Moss\n\nCreate a digest.\n\n```sh\nprintf "? Choose install scope\\nGlobal / Project\\n"\n```',
  );
  await write(path.join(work, "command-plan.json"), {
    projectTests: { skip: "User forbids target UI tests." },
    blocks: [{ index: 0, expectStdout: "Installed successfully" }],
  });
  let r = await verify({ repo, work, local: true });
  const c = (id) => r.checks.find((c) => c.id === id);
  assert.equal(c("V8").status, "skip");
  assert.match(c("V8").reason, /forbids/);
  assert.equal(c("V1").status, "fail");
  assert.match(c("V1").issues.join(" "), /stdout/i);
  assert.ok(c("V1").results[0].warnings.length);
  await write(
    path.join(repo, "README.md"),
    '# Moss\n\nCreate a digest.\n\n```sh\nprintf "Installed successfully\\n"\n```',
  );
  await write(path.join(work, "command-plan.json"), {
    projectTests: { command: 'node -e "process.exit(0)"' },
    blocks: [{ index: 0, expectStdout: "Installed successfully" }],
  });
  r = await verify({ repo, work, local: true });
  assert.equal(c("V1").status, "pass");
  assert.equal(c("V8").status, "pass");
  assert.deepEqual(c("V1").results[0].warnings, []);
  await write(path.join(work, "command-plan.json"), {
    projectTests: { command: "exit 2" },
    blocks: [{ index: 0 }],
  });
  r = await verify({ repo, work, local: true });
  assert.equal(c("V8").status, "fail");
});
test("P4 actual content rejects sparse card and left/right imbalance, dense content remains valid", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const show = async (html) => {
    await page.setContent(
      '<style>body{margin:0;color:#111;background:white;font:18px/24px Arial}.frame{width:900px;height:300px}.card{height:290px;width:890px}p{margin:0}</style><main class="frame">' +
        html +
        "</main>",
    );
    return inspectArt(page);
  };
  let r = await show('<div class="card"><span>One line.</span></div>');
  assert.equal(r.checks.density, "fail");
  assert.equal(r.checks.balance, "fail");
  r = await show(
    '<div style="display:flex"><div style="width:440px">' +
      "<p>Traceable source values cover this content row.</p>".repeat(12) +
      "</div></div>",
  );
  assert.equal(r.checks.balance, "fail");
  r = await show(
    '<div style="display:flex">' +
      (
        '<div style="width:450px">' +
        "<p>Traceable source values cover this content row.</p>".repeat(12) +
        "</div>"
      ).repeat(2) +
      "</div>",
  );
  assert.equal(r.checks.density, "pass");
  assert.equal(r.checks.balance, "pass");
});
async function linkFixture() {
  const dir = await tmp();
  const output = {
    entries: [
      { name: "primary", value: "#2f6f4e", line: 2 },
      { name: "surface", value: "#ffffff", line: 3 },
    ],
  };
  await write(path.join(dir, "tokens.json"), output);
  await write(
    path.join(dir, "style.css"),
    ":root {\n  --primary: #2f6f4e;\n  --surface: #ffffff;\n}\n",
  );
  await write(path.join(dir, "captures/demo.json"), {
    id: "demo",
    role: "core",
    kind: "command-run",
    command: "node extract.mjs",
    stdout: "2 tokens extracted",
    exitCode: 0,
    outputs: [
      {
        file: "tokens.json",
        sha256: hash(await fs.readFile(path.join(dir, "tokens.json"))),
      },
    ],
    summary: { matched: 2 },
  });
  const spec = {
    images: [
      {
        id: "hero",
        template: "hero-link",
        captureId: "demo",
        link: {
          output: "tokens.json",
          outputPath: "entries",
          source: "style.css",
          items: [0, 1].map((index) => ({
            index,
            name: "name",
            value: "value",
            line: "line",
          })),
          focus: 0,
          status: { from: "capture", path: "summary.matched" },
        },
      },
    ],
  };
  await write(path.join(dir, "art.json"), spec);
  return {
    dir,
    spec,
    render: () =>
      renderArt({
        spec: path.join(dir, "art.json"),
        out: path.join(dir, "out"),
      }),
  };
}
test("hero-link renders four variants, hashes source/output, records valid endpoints and regenerates without cache", async () => {
  const { dir, render } = await linkFixture();
  const r = await render();
  assert.equal(r.files.length, 4);
  for (const f of r.files) {
    assert.equal(f.template, "hero-link");
    assert.equal(f.checks.links, "pass");
    assert.equal(
      f.link.source.sha256,
      hash(await fs.readFile(path.join(dir, "style.css"))),
    );
    assert.equal(f.link.items.length, 2);
  }
  await fs.rm(path.join(dir, "captures"), { recursive: true });
  await fs.rm(path.join(dir, "tokens.json"));
  await fs.rm(path.join(dir, "style.css"));
  assert.equal(
    (
      await renderArt({
        spec: path.join(dir, "out/art.json"),
        out: path.join(dir, "again"),
      })
    ).files.length,
    4,
  );
});
test("hero-link refuses unhashed/changed output, mismatched/out-of-range source, absent status, too many items and bad focus", async () => {
  for (const mutation of [
    "hash",
    "unrecorded",
    "line",
    "value",
    "status",
    "count",
    "focus",
  ]) {
    const { dir, spec, render } = await linkFixture();
    if (mutation === "hash")
      await write(path.join(dir, "tokens.json"), { entries: [] });
    if (mutation === "unrecorded") {
      const c = await json(path.join(dir, "captures/demo.json"));
      c.outputs = [];
      await write(path.join(dir, "captures/demo.json"), c);
    }
    if (["line", "value"].includes(mutation)) {
      const o = await json(path.join(dir, "tokens.json"));
      o.entries[0][mutation] = mutation === "line" ? 200 : "invented";
      await write(path.join(dir, "tokens.json"), o);
      const c = await json(path.join(dir, "captures/demo.json"));
      c.outputs[0].sha256 = hash(
        await fs.readFile(path.join(dir, "tokens.json")),
      );
      await write(path.join(dir, "captures/demo.json"), c);
    }
    if (mutation === "status") spec.images[0].link.status.path = "invented";
    if (mutation === "count")
      spec.images[0].link.items = Array(7).fill(spec.images[0].link.items[0]);
    if (mutation === "focus") spec.images[0].link.focus = 9;
    await write(path.join(dir, "art.json"), spec);
    await assert.rejects(render(), undefined, mutation);
  }
});
test("P3 resultLabel is localized or neutral, never writing-specific", async () => {
  const dir = await tmp();
  await write(path.join(dir, "captures/demo.json"), {
    role: "core",
    command: "node extract.mjs",
    stdout: "tokens\ncolors\nfonts\nspacing",
  });
  const spec = {
    images: [
      {
        id: "hero",
        template: "hero-code",
        captureId: "demo",
        title: { en: "Tokens", "zh-CN": "令牌" },
        subtitle: { en: "Read CSS values.", "zh-CN": "读取样式值。" },
      },
    ],
  };
  await write(path.join(dir, "art.json"), spec);
  const r = await renderArt({
    spec: path.join(dir, "art.json"),
    out: path.join(dir, "out"),
  });
  assert.equal(r.files[0].labels.result, "Output");
  spec.images[0].resultLabel = { en: "Design tokens", "zh-CN": "设计令牌" };
  await write(path.join(dir, "art.json"), spec);
  assert.equal(
    (
      await renderArt({
        spec: path.join(dir, "art.json"),
        out: path.join(dir, "out"),
      })
    ).files[0].labels.result,
    "Design tokens",
  );
});
test("hero-link V10 accepts core and rejects supporting capture", async () => {
  const { dir, spec, render } = await linkFixture();
  const repo = await tmp();
  await fs.mkdir(path.join(repo, "docs"), { recursive: true });
  await fs.cp(dir, path.join(repo, "docs/readme"), { recursive: true });
  const brief = {
    coreAction: {
      what: "Extract tokens",
      input: "CSS",
      command: "node extract.mjs",
      output: { keywords: ["tokens"] },
      factIds: ["extract"],
    },
  };
  assert.equal((await heroRelevance(repo, brief)).status, "pass");
  const p = path.join(repo, "docs/readme/captures/demo.json"),
    c = await json(p);
  c.role = "supporting";
  await write(p, c);
  assert.equal((await heroRelevance(repo, brief)).status, "fail");
});
test("P9 V9 checks display-scaled primary fonts including dark picture sources", async () => {
  const repo = await tmp(),
    work = await tmp(),
    base = path.join(repo, "docs/readme");
  await write(
    path.join(repo, "README.md"),
    '# Moss\n\nCreate a digest.\n\n<picture><source srcset="docs/readme/hero-dark.png" media="(prefers-color-scheme: dark)"><img src="docs/readme/hero-light.png" width="600" alt="Digest"></picture>',
  );
  const checks = Object.fromEntries(
    [
      "overflow",
      "fontSize",
      "mainText",
      "contrast",
      "fields",
      "density",
      "balance",
      "size",
    ].map((k) => [k, "pass"]),
  );
  await fs.mkdir(base, { recursive: true });
  const bytes = await fs.readFile("docs/readme/hero-light.png");
  for (const name of ["light", "dark"])
    await fs.writeFile(path.join(base, `hero-${name}.png`), bytes);
  const manifest = {
    files: ["light", "dark"].map((theme) => ({
      file: `hero-${theme}.png`,
      sha256: hash(bytes),
      cssWidth: 900,
      minMainFontSize: 18,
      checks,
    })),
  };
  await write(path.join(base, "art-manifest.json"), manifest);
  let r = await verify({ repo, work, local: true });
  assert.match(
    r.checks.find((c) => c.id === "V9").issues.join(" "),
    /scaled.*font|display.*font/i,
  );
  for (const f of manifest.files) f.minMainFontSize = 21;
  await write(path.join(base, "art-manifest.json"), manifest);
  r = await verify({ repo, work, local: true });
  assert.equal(
    r.checks.find((c) => c.id === "V9").status,
    "pass",
    JSON.stringify(r.checks.find((c) => c.id === "V9")),
  );
});
test("capture preserves generated output bytes and hashes before removing its disposable copy", async () => {
  const repo = await tmp(),
    work = await tmp();
  await write(path.join(repo, "input.txt"), "source");
  const r = await capture({
    repo,
    work,
    id: "demo",
    outputs: "tokens.json",
    command: `node -e 'require("fs").writeFileSync("tokens.json",JSON.stringify({entries:[1]}))'`,
  });
  assert.equal(r.outputs.length, 1);
  assert.equal(
    hash(await fs.readFile(path.join(work, r.outputs[0].file))),
    r.outputs[0].sha256,
  );
  await assert.rejects(fs.access(path.join(repo, "tokens.json")));
});

test("P7 supplemental literal string passes and wrong type/line/substrings fail V5", async () => {
  const repo = await tmp(),
    work = await tmp();
  await write(path.join(repo, "README.md"), "# Moss\n\nCreate a digest.");
  await write(path.join(repo, "entry.mjs"), 'export const mode = "digest";\n');
  for (const [value, source, expected] of [
    ['mode = "digest"', "entry.mjs:1", "pass"],
    [true, "entry.mjs:1", "fail"],
    ["invented", "entry.mjs:1", "fail"],
    ["digest", "entry.mjs:2", "fail"],
  ]) {
    await write(path.join(repo, "docs/readme/facts.json"), [
      { id: "mode", claim: "Emits a digest", value, source },
    ]);
    const r = await verify({ repo, work, local: true });
    assert.equal(r.checks.find((c) => c.id === "V5").status, expected);
  }
});
test("links self-check fails an endpoint outside its source panel", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(
    '<style>body{margin:0}.frame{width:900px;height:300px}.link-panels{position:relative;display:flex}.card{width:400px;height:200px}svg{position:absolute;inset:0}</style><main class="frame"><div class="link-panels" data-focus="0"><div class="card output-panel">output</div><div class="card source-panel">source</div><svg><path/></svg></div></main>',
  );
  await page
    .locator(".link-panels")
    .evaluate(
      (e) =>
        (e.dataset.endpoints = JSON.stringify([
          { index: 0, x1: 399, y1: 100, x2: 999, y2: 100 },
        ])),
    );
  assert.equal((await inspectArt(page)).checks.links, "fail");
  await page
    .locator(".link-panels")
    .evaluate(
      (e) =>
        (e.dataset.endpoints = JSON.stringify([
          { index: 0, x1: 399, y1: 100, x2: 401, y2: 100 },
        ])),
    );
  assert.equal((await inspectArt(page)).checks.links, "pass");
});
test("hero-link separate hashed provenance, evidence substring and verify status survive output copying", async () => {
  const { dir, spec, render } = await linkFixture();
  const c = await json(path.join(dir, "captures/demo.json"));
  await write(path.join(dir, "sources.json"), {
    "color.primary": { line: 2, authoredValue: "#2f6f4e" },
  });
  c.outputs.push({
    file: "sources.json",
    sha256: hash(await fs.readFile(path.join(dir, "sources.json"))),
  });
  await write(path.join(dir, "captures/demo.json"), c);
  await write(path.join(dir, "verify.json"), { summary: { pass: 2 } });
  spec.images[0].link.items[0].source = {
    file: "sources.json",
    path: "/color.primary",
  };
  spec.images[0].link.items[0].evidence = "authoredValue";
  spec.images[0].link.status = { from: "verify", path: "summary.pass" };
  await write(path.join(dir, "art.json"), spec);
  assert.equal((await render()).files[0].link.status.value, "2");
  await write(path.join(dir, "sources.json"), {
    "color.primary": { line: 3, authoredValue: "#2f6f4e" },
  });
  await assert.rejects(render(), /provenance hash mismatch/);
});

test("hero-link long CSS lines become explicit excerpts without hiding the cited evidence", async () => {
  const { dir, spec, render } = await linkFixture();
  const css =
    ":root {\n  --primary: #2f6f4e; " +
    "margin: 0; ".repeat(40) +
    "\n  --surface: #ffffff;\n}\n";
  await write(path.join(dir, "style.css"), css);
  const r = await render();
  assert.ok(r.files.every((f) => f.cssHeight < 600));
  assert.ok(r.files.every((f) => f.checks.overflow === "pass"));
  assert.ok(
    r.files[0].link.excerpts.some(
      (e) => e.text.includes("…") && e.text.includes("#2f6f4e"),
    ),
  );
});

test("global npm command plans use a disposable prefix, never the host prefix", async () => {
  const repo = await tmp(),
    work = await tmp();
  const r = await capture({
    repo,
    work,
    id: "prefix",
    command: `npm prefix --global
node -e 'process.exit(require("fs").existsSync(process.env.npm_config_prefix+"/lib/node_modules")?0:1)'`,
  });
  assert.match(r.stdout.trim(), /readme-run-[^/]+\/home\/\.local$/);
  assert.equal(r.exitCode, 0);
});

test("V5 accepts --global for the real package and still rejects a different package", async () => {
  const repo = await tmp();
  const f = { ...facts, manifest: { name: "moss" } };
  await write(
    path.join(repo, "README.md"),
    "# Moss\n\nCreate a digest.\n\n```sh\nnpm install --global moss\n```",
  );
  assert.equal(
    (await staticChecks(repo, f)).find((c) => c.id === "V5").status,
    "pass",
  );
  await write(
    path.join(repo, "README.md"),
    "# Moss\n\nCreate a digest.\n\n```sh\nnpm install --global other\n```",
  );
  assert.equal(
    (await staticChecks(repo, f)).find((c) => c.id === "V5").status,
    "fail",
  );
});

test("isolated npm exec can discover an existing local binary with a fresh prefix", async () => {
  const repo = await tmp(),
    work = await tmp();
  const bin = path.join(repo, "node_modules/.bin/rfc-local-bin");
  await write(bin, "#!/bin/sh\necho ready\n");
  await fs.chmod(bin, 0o755);
  const r = await capture({
    repo,
    work,
    id: "exec",
    command: "npm exec --offline -- rfc-local-bin",
  });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /ready/);
});

test("isolated npx installs and executes a local package without host prefix directories", async () => {
  const repo = await tmp(),
    work = await tmp();
  await write(path.join(repo, "fixture/package.json"), {
    name: "rfc-npx-fixture",
    version: "1.0.0",
    bin: { "rfc-npx-fixture": "cli.js" },
  });
  await write(
    path.join(repo, "fixture/cli.js"),
    '#!/usr/bin/env node\nconsole.log("fixture ready")\n',
  );
  const r = await capture({
    repo,
    work,
    id: "npx",
    command: "npm exec --offline --yes --package ./fixture -- rfc-npx-fixture",
  });
  assert.equal(r.exitCode, 0, r.stderr);
  assert.match(r.stdout, /fixture ready/);
});

test("compact hero-code renders hashed input bytes rather than an internal wrapper command", async () => {
  const repo = await tmp(),
    work = await tmp();
  await write(path.join(repo, "input.jsonc"), '{ // note\n "port": 8080,\n}\n');
  const c = await capture({
    repo,
    work,
    id: "core",
    role: "core",
    "input-file": "input.jsonc",
    command: `node -e 'console.log("{\\n \\\"port\\\": 8080\\n}")'`,
  });
  assert.equal(c.input, '{ // note\n "port": 8080,\n}\n');
  const spec = {
    images: [
      {
        id: "hero",
        template: "hero-code",
        captureId: "core",
        compact: true,
        title: { en: "Actual transform", "zh-CN": "真实转换" },
        subtitle: { en: "Actual JSON", "zh-CN": "真实 JSON" },
      },
    ],
  };
  await write(path.join(work, "art.json"), spec);
  const r = await renderArt({
    spec: path.join(work, "art.json"),
    out: path.join(work, "out"),
  });
  assert.ok(r.files.every((f) => f.cssHeight < 300));
  assert.equal(r.files[0].inputFile.sha256, hash(c.input));
  await write(path.join(work, c.inputFile.file), "invented");
  await assert.rejects(
    renderArt({
      spec: path.join(work, "art.json"),
      out: path.join(work, "out"),
    }),
    /input.*hash|input.*mismatch/i,
  );
});
test("hero-link six rows stay compact enough for a branded first screen", async () => {
  const { dir, spec, render } = await linkFixture();
  const o = {
    entries: Array.from({ length: 6 }, (_, i) => ({
      name: "color.token" + i,
      value: "#2f6f4e",
      line: i + 2,
    })),
  };
  await write(path.join(dir, "tokens.json"), o);
  await write(
    path.join(dir, "style.css"),
    ":root {\n" +
      o.entries.map((e, i) => ` --token-${i}: #2f6f4e;`).join("\n") +
      "\n}\n",
  );
  const c = await json(path.join(dir, "captures/demo.json"));
  c.outputs[0].sha256 = hash(await fs.readFile(path.join(dir, "tokens.json")));
  await write(path.join(dir, "captures/demo.json"), c);
  spec.images[0].link.items = o.entries.map((_, index) => ({
    index,
    name: "name",
    value: "value",
    line: "line",
  }));
  await write(path.join(dir, "art.json"), spec);
  const r = await render();
  assert.ok(r.files.every((f) => f.cssHeight <= 420));
});

test("portable art retains all hashed capture outputs, including original JSON behind a projected view", async () => {
  const { dir, render } = await linkFixture();
  const c = await json(path.join(dir, "captures/demo.json"));
  await write(path.join(dir, "original-sources.json"), {
    source: "raw provenance",
  });
  c.outputs.push({
    file: "original-sources.json",
    sha256: hash(await fs.readFile(path.join(dir, "original-sources.json"))),
  });
  await write(path.join(dir, "captures/demo.json"), c);
  await render();
  assert.deepEqual(await json(path.join(dir, "out/original-sources.json")), {
    source: "raw provenance",
  });
});

test("P8 V6 uses the visible HTML tagline instead of a later long image caption", async () => {
  const repo = await tmp();
  const brief = {
    coreAction: { output: { keywords: ["tokens", "设计令牌"] } },
  };
  await write(path.join(repo, "README.md"), "# Moss\n\nTurn CSS into tokens.");
  await write(
    path.join(repo, "README.zh-CN.md"),
    "<h3>从样式生成设计令牌。</h3>\n\n" +
      "这是图片的详细注释，而不是一句话介绍。".repeat(2),
  );
  assert.ok(
    !(await staticChecks(repo, facts, brief))
      .find((c) => c.id === "V6")
      .issues.some((s) => s.includes("One-liner")),
  );
  await write(
    path.join(repo, "README.zh-CN.md"),
    "<h3>" + "设计令牌".repeat(11) + "</h3>\n\n图片注释。",
  );
  assert.match(
    (await staticChecks(repo, facts, brief))
      .find((c) => c.id === "V6")
      .issues.join(" "),
    /One-liner exceeds 40/,
  );
});
