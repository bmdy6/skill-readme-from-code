import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { json, write, hash } from "./io.mjs";
const loopback = (value) => {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
  )
    throw Error("web capture requires loopback URLs");
  return u;
};
const alive = (p) => {
  try {
    process.kill(-p.pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function stop(p) {
  if (!alive(p)) return;
  try {
    process.kill(-p.pid, "SIGTERM");
  } catch {}
  for (let i = 0; i < 30 && alive(p); i++) await delay(50);
  if (alive(p)) {
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {}
    await delay(50);
  }
}
export async function captureWeb(o) {
  if (!/^[\w-]+$/.test(o.id || "")) throw Error("capture requires a safe --id");
  const brief =
    typeof o.brief === "object"
      ? o.brief
      : await json(o.brief || path.join(o.work, "brief.json"));
  const c = brief?.webCapture;
  if (!c || !Array.isArray(c.setup) || !Array.isArray(c.prepare))
    throw Error(
      "webCapture requires explicit setup and prepare command arrays",
    );
  if (!c.data?.trim() || !c.services?.length || !c.pages?.length)
    throw Error("webCapture requires data, services and pages");
  const timeoutMs = c.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 3600000)
    throw Error("Invalid timeoutMs");
  for (const cmd of [
    ...c.setup,
    ...c.prepare,
    ...c.services.map((s) => s.command),
  ])
    if (typeof cmd !== "string" || !cmd.trim())
      throw Error("Explicit command required");
  const origins = new Set();
  for (const s of c.services) origins.add(loopback(s.readyUrl).origin);
  const ids = new Set();
  for (const p of c.pages) {
    origins.add(loopback(p.url).origin);
    if (!/^[\w-]+$/.test(p.id || "") || ids.has(p.id))
      throw Error("Invalid or duplicate page id");
    ids.add(p.id);
    if (
      !p.waitFor ||
      !Number.isInteger(p.viewport?.width) ||
      !Number.isInteger(p.viewport?.height) ||
      p.viewport.width < 200 ||
      p.viewport.width > 3840 ||
      p.viewport.height < 40 ||
      p.viewport.height > 2160
    )
      throw Error("Explicit waitFor and viewport required");
  }
  const dir = path.join(o.work, "capture-files", o.id);
  await fs.mkdir(dir, { recursive: true });
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  // Only explicitly declared synthetic configuration is passed; never inherit model/API keys.
  Object.assign(env, c.env || {});
  const processes = [],
    result = {
      id: o.id,
      kind: "web-app",
      data: c.data,
      commands: [],
      services: [],
      pages: [],
      ok: false,
      cleanedUp: false,
    };
  let browser;
  function start(command) {
    const p = spawn(command, {
      cwd: o.repo,
      env,
      shell: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = { command, pid: p.pid, stdout: "", stderr: "" };
    result.commands.push(log);
    p.stdout.on("data", (b) => {
      log.stdout += b;
    });
    p.stderr.on("data", (b) => {
      log.stderr += b;
    });
    p.on("error", (e) => {
      log.error = e.message;
    });
    p.on("exit", (code, signal) => {
      log.exitCode = code;
      log.signal = signal;
    });
    processes.push(p);
    return { p, log };
  }
  async function run(command) {
    const { p, log } = start(command);
    const done = new Promise((res, rej) => {
      p.once("error", rej);
      p.once("exit", (code) =>
        code === 0 ? res() : rej(Error(`Command exited ${code}: ${command}`)),
      );
    });
    let timer;
    try {
      await Promise.race([
        done,
        new Promise((_, rej) => {
          timer = setTimeout(
            () => rej(Error(`Command timeout: ${command}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (alive(p)) await stop(p);
    }
    return log;
  }
  try {
    for (const cmd of c.setup) await run(cmd);
    for (const s of c.services) {
      // Refuse to capture an unrelated process already occupying the requested endpoint.
      try {
        const r = await fetch(s.readyUrl, { signal: AbortSignal.timeout(400) });
        if (r) throw Error("Ready endpoint already occupied");
      } catch (e) {
        if (e.message === "Ready endpoint already occupied") throw e;
      }
      const { p } = start(s.command),
        entry = { ...s, pid: p.pid };
      result.services.push(entry);
      const until = Date.now() + timeoutMs;
      let ready = false;
      while (Date.now() < until) {
        if (p.exitCode !== null)
          throw Error(`Service exited before readiness: ${s.command}`);
        try {
          const r = await fetch(s.readyUrl, {
            signal: AbortSignal.timeout(Math.min(timeoutMs, 1000)),
          });
          if (r.ok) {
            ready = true;
            entry.readyStatus = r.status;
            break;
          }
        } catch {}
        await delay(50);
      }
      if (!ready) throw Error(`Readiness timeout: ${s.readyUrl}`);
    }
    for (const cmd of c.prepare) await run(cmd);
    browser = await chromium.launch({ headless: true });
    for (const p of c.pages) {
      const state = p.storageState || c.storageState;
      const context = await browser.newContext({
        serviceWorkers: "block",
        viewport: p.viewport,
        ...(state ? { storageState: path.resolve(o.repo, state) } : {}),
      });
      await context.route("**/*", (route) => {
        const u = new URL(route.request().url());
        return !["http:", "https:"].includes(u.protocol) ||
          origins.has(u.origin)
          ? route.continue()
          : route.abort();
      });
      const page = await context.newPage();
      const response = await page.goto(p.url, {
        waitUntil: "load",
        timeout: timeoutMs,
      });
      if (response && !response.ok())
        throw Error(`Page returned ${response.status()}: ${p.url}`);
      await page.waitForSelector(p.waitFor, { timeout: timeoutMs });
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(dir, p.id + ".png");
      await page.screenshot({ path: file });
      const bytes = await fs.readFile(file);
      result.pages.push({
        ...p,
        finalUrl: page.url(),
        file: path.relative(o.work, file),
        sha256: hash(bytes),
        bytes: bytes.length,
      });
      await context.close();
    }
    result.ok = true;
  } catch (e) {
    result.error = e.message;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      result.ok = false;
      result.error = [result.error, `Browser cleanup failed: ${e.message}`]
        .filter(Boolean)
        .join("; ");
    }
    for (const p of processes.reverse()) await stop(p);
    result.cleanedUp = processes.every((p) => !alive(p));
    if (!result.cleanedUp) {
      result.ok = false;
      result.error = [result.error, "Service cleanup failed"]
        .filter(Boolean)
        .join("; ");
    }
    await write(path.join(o.work, "captures", o.id + ".json"), result);
  }
  return result;
}
