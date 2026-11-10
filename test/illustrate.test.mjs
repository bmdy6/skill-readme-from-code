import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { execFileSync } from "node:child_process";
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
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"]);
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

async function layoutFixture(t, {long = false, count = 1, height = 80, step = false} = {}) {
  const o = await fixture(t);
  if (long) {
    await fs.writeFile(path.join(o.repo, "README.md"), original.replace("## Install", "Paragraph.\n\n".repeat(long === true ? 60 : long) + "## Install"));
    execFileSync("git", ["-C", o.repo, "commit", "-am", "long baseline", "--author=Test <test@example.invalid>"], {env:{...process.env,GIT_COMMITTER_NAME:"Test",GIT_COMMITTER_EMAIL:"test@example.invalid"}});
    await fs.rm(path.join(o.work, "illustrate-baseline.json"));
    await illustrateBaseline(o);
  }
  const { illustrationBlock } = await import("../scripts/lib/illustrate.mjs");
  const entries = Array.from({length:count}, (_,n) => ({id:`flow-${n}`,readme:"README.md",file:`flow-${n}.svg`,alt:"Flow",caption:"Illustration: workflow.",width:600,placement:step?"step":"hero",source:{kind:"illustration",command:"node draw.mjs",data:"Synthetic flow"}}));
  for (const i of entries) await fs.writeFile(path.join(o.repo,i.file), `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${height}"/>`);
  const md = await fs.readFile(path.join(o.repo,"README.md"),"utf8");
  await fs.writeFile(path.join(o.repo,"README.md"), md.replace("## Install",entries.map(illustrationBlock).join("")+"## Install"));
  await fs.writeFile(path.join(o.work,"illustrate.json"),JSON.stringify({images:entries}));
  return o;
}
test("baseline stores commit/blob references only and refuses dirty README", async t => {
  const o = await fixture(t), b = JSON.parse(await fs.readFile(path.join(o.work,"illustrate-baseline.json")));
  assert.match(b.commit, /^[a-f0-9]{40}$/);
  assert.match(b.readmes[0].blob, /^[a-f0-9]{40}$/);
  assert.equal(b.readmes[0].text, undefined);
  await fs.rm(path.join(o.work,"illustrate-baseline.json"));
  await fs.appendFile(path.join(o.repo,"README.md"), "dirty");
  await assert.rejects(() => illustrateBaseline(o), /committed|dirty/i);
});
test("at most one image before installation even when baseline was below fold", async t => {
  const r = await verifyIllustrate({...await layoutFixture(t,{long:true,count:2}),local:true});
  assert.equal(r.checks.find(c=>c.id==="placement")?.status,"fail");
});
test("hero rendered height is capped at 420px even for a below-fold baseline", async t => {
  const r = await verifyIllustrate({...await layoutFixture(t,{long:true,height:450}),local:true});
  assert.equal(r.checks.find(c=>c.id==="placement")?.status,"fail");
});
test("steps cannot precede installation", async t => {
  const r = await verifyIllustrate({...await layoutFixture(t,{step:true}),local:true});
  assert.equal(r.checks.find(c=>c.id==="placement")?.status,"fail");
});
test("pre-existing below-fold install is a warning, not a hard failure", async t => {
  const r = await verifyIllustrate({...await layoutFixture(t,{long:true}),local:true});
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.ok(r.checks.find(c=>c.id==="first-screen").warnings.length);
});
test("captions stay one line and synthetic disclaimer occurs once", async t => {
  const o = await layoutFixture(t,{long:true});
  const spec = JSON.parse(await fs.readFile(path.join(o.work,"illustrate.json")));
  const {illustrationBlock} = await import("../scripts/lib/illustrate.mjs");
  const old=illustrationBlock(spec.images[0]);
  spec.images[0].caption="Illustration: synthetic data.\nNo model calls.";
  const file=path.join(o.repo,"README.md");
  await fs.writeFile(file,(await fs.readFile(file,"utf8")).replace(old,illustrationBlock(spec.images[0])));
  await fs.writeFile(path.join(o.work,"illustrate.json"),JSON.stringify(spec));
  const r=await verifyIllustrate({...o,local:true});
  assert.match(JSON.stringify(r.checks),/caption.*one line/i);
});
test("skill states compact provenance and clean synthetic content rules", async () => {
  const skill=await fs.readFile(new URL("../SKILL.md",import.meta.url),"utf8");
  assert.match(skill,/420/);
  assert.match(skill,/blob/);
  assert.match(skill,/disclaimers.*synthetic|synthetic.*disclaimers/i);
});
test("repeated synthetic/model-call declarations fail", async t => {
  const o=await layoutFixture(t,{long:true,count:2});
  const {illustrationBlock}=await import("../scripts/lib/illustrate.mjs");
  const file=path.join(o.repo,"README.md"), spec=JSON.parse(await fs.readFile(path.join(o.work,"illustrate.json")));
  let md=await fs.readFile(file,"utf8");
  for(const i of spec.images){const old=illustrationBlock(i);i.caption="Illustration: synthetic data, no model calls.";md=md.replace(old,illustrationBlock(i));}
  await fs.writeFile(file,md);await fs.writeFile(path.join(o.work,"illustrate.json"),JSON.stringify(spec));
  const r=await verifyIllustrate({...o,local:true});
  assert.match(JSON.stringify(r.checks.find(c=>c.id==="images")),/declaration.*once/i);
});
test("compact manifest replays git baseline and three-column gallery with one marker pair", async t => {
  const o=await layoutFixture(t,{count:3});
  const {illustrationBlock}=await import("../scripts/lib/illustrate.mjs");
  const {hash}=await import("../scripts/lib/io.mjs");
  const spec=JSON.parse(await fs.readFile(path.join(o.work,"illustrate.json")));
  spec.baseline=JSON.parse(await fs.readFile(path.join(o.work,"illustrate-baseline.json")));
  spec.sources="SOURCES.md";
  for(const i of spec.images){delete i.source;i.placement="step";i.group="steps";i.sha256=hash(await fs.readFile(path.join(o.repo,i.file)));}
  const gallery=illustrationBlock({id:"steps",images:spec.images});
  assert.equal((gallery.match(/<!-- readme-illustrate:/g)||[]).length,1);
  assert.equal((gallery.match(/<td /g)||[]).length,3);
  assert.equal((gallery.match(/<a href/g)||[]).length,3);
  await fs.writeFile(path.join(o.repo,"README.md"),original+gallery);
  await fs.writeFile(path.join(o.repo,"SOURCES.md"),spec.images.map(i=>`${i.file}: ${i.sha256} — original illustration via node draw.mjs`).join("\n"));
  await fs.writeFile(path.join(o.work,"illustrate.json"),JSON.stringify(spec));
  await fs.rm(path.join(o.work,"illustrate-baseline.json"));
  const r=await verifyIllustrate({...o,local:true});
  assert.equal(r.ok,true,JSON.stringify(r));
});
test("an added image cannot push an initially visible install below the fold", async t => {
  const o=await layoutFixture(t,{height:400,long:4});
  const r=await verifyIllustrate({...o,local:true});
  const first = r.checks.find(c=>c.id==="first-screen");
  assert.equal(first.screens[0].baseline.checks.install,true);
  assert.equal(first.status,"fail");
  assert.equal(r.checks.find(c=>c.id==="placement").status,"pass");
});
test("a missing baseline installation is a failure rather than a below-fold warning", async t => {
  const o=await fixture(t);
  await fs.writeFile(path.join(o.work,"brief.json"),JSON.stringify({install:{block:"npm missing"}}));
  await fs.writeFile(path.join(o.work,"illustrate.json"),'{"images":[]}');
  const r=await verifyIllustrate({...o,local:true});
  assert.equal(r.ok,false);
  assert.match(JSON.stringify(r.checks),/installation.*missing/i);
});
