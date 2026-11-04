#!/usr/bin/env node
// Run every shell block in a README inside a throwaway sandbox and report.
// Every block must be covered by the plan: either run, or skipped with a reason.
// Usage: node verify-commands.mjs --readme README.md --plan plan.json --out report.json
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);

export function shellBlocks(md) {
  const out = [];
  const re = /^```(sh|bash|shell|console|zsh)\s*\n([\s\S]*?)^```/gm;
  for (const m of md.matchAll(re)) {
    const line = md.slice(0, m.index).split("\n").length;
    out.push({ index: out.length, line, code: m[2].trimEnd() });
  }
  return out;
}

function exec(code, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("bash", ["-e", "-o", "pipefail", "-c", code], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (exit, signal) => {
      clearTimeout(timer);
      resolve({ exit, signal, ms: Date.now() - t0, tail: log.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n").slice(-12).join("\n") });
    });
  });
}

export async function verify({ readme, plan, out }) {
  const md = await fs.readFile(readme, "utf8");
  const cfg = JSON.parse(await fs.readFile(plan, "utf8"));
  const blocks = shellBlocks(md);
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "storefront-"));
  const home = path.join(sandbox, "home");
  await fs.mkdir(home, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: home, // clean npm/git/skills state; browser cache is shared only if the plan says so
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    CI: "1",
    ...(cfg.shareBrowserCache && { PLAYWRIGHT_BROWSERS_PATH: path.join(os.homedir(), ".cache/ms-playwright") }),
    ...cfg.env,
  };
  const results = [];
  for (const b of blocks) {
    const rule = (cfg.blocks || []).find((r) => b.code.includes(r.match));
    if (!rule) {
      results.push({ ...b, status: "uncovered" });
      continue;
    }
    if (rule.skip) {
      results.push({ ...b, status: "skipped", reason: rule.skip });
      continue;
    }
    let code = b.code;
    if (rule.append) code = code.split("\n").map((l) => (l.includes(rule.match) ? l + " " + rule.append : l)).join("\n");
    for (const [from, to] of Object.entries(cfg.rewrite || {})) code = code.split(from).join(to);
    const cwd = path.join(sandbox, rule.cwd || ".");
    await fs.mkdir(cwd, { recursive: true });
    if (rule.before) await exec(rule.before, cwd, env, 600000);
    const r = await exec(code, cwd, env, (rule.timeoutSec || 600) * 1000);
    const expect = rule.expectExit ?? 0;
    results.push({ ...b, status: r.exit === expect ? "passed" : "failed", ...r, expectExit: expect, cwd: rule.cwd || ".", ...(rule.append && { ran: code, note: rule.note }) });
  }
  const summary = Object.fromEntries(["passed", "failed", "skipped", "uncovered"].map((s) => [s, results.filter((r) => r.status === s).length]));
  const report = { readme, sandbox, sharedBrowserCache: !!cfg.shareBrowserCache, rewrite: cfg.rewrite || {}, summary, ok: !summary.failed && !summary.uncovered, results };
  if (out) await fs.writeFile(out, JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await verify(args);
  console.log(JSON.stringify({ ok: r.ok, summary: r.summary, sandbox: r.sandbox }, null, 1));
  for (const x of r.results) console.log(`${x.status.padEnd(9)} L${x.line}  ${x.code.split("\n")[0]}${x.ms ? `  (${(x.ms / 1000).toFixed(1)}s)` : ""}${x.reason ? `  — ${x.reason}` : ""}`);
  process.exit(r.ok ? 0 : 1);
}
