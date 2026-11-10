import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { captureWeb } from "../scripts/lib/capture-web.mjs";
async function fixture(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "web-capture-"));
  t.after(() => fs.rm(repo, { force: true, recursive: true }));
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  await fs.writeFile(
    path.join(repo, "server.mjs"),
    `import http from 'node:http'; http.createServer((q,s)=>{s.end('<h1>Synthetic plan</h1>')}).listen(${port},'127.0.0.1');`,
  );
  const brief = {
    webCapture: {
      setup: [],
      prepare: [],
      data: "Synthetic plan fixture",
      services: [
        {
          command: "node server.mjs",
          readyUrl: `http://127.0.0.1:${port}/health`,
        },
      ],
      pages: [
        {
          id: "plan",
          url: `http://127.0.0.1:${port}/plan`,
          viewport: { width: 800, height: 600 },
          waitFor: "h1",
        },
      ],
      timeoutMs: 3000,
    },
  };
  return { repo, work: path.join(repo, "work"), id: "demo", brief, port };
}
test("web capture records real route, viewport, commands, hash and closes service", async (t) => {
  const f = await fixture(t),
    r = await captureWeb(f);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.pages[0].url, f.brief.webCapture.pages[0].url);
  assert.equal(r.pages[0].sha256.length, 64);
  assert.equal(r.cleanedUp, true);
  await assert.rejects(() => fetch(f.brief.webCapture.services[0].readyUrl));
});
test("unready service is a saved failure, with no fabricated image and cleanup", async (t) => {
  const f = await fixture(t);
  f.brief.webCapture.services[0].readyUrl = `http://127.0.0.1:${f.port + 1}/`;
  f.brief.webCapture.timeoutMs = 300;
  const r = await captureWeb(f);
  assert.equal(r.ok, false);
  assert.equal(r.pages.length, 0);
  assert.equal(r.cleanedUp, true);
  await assert.rejects(() => fetch(`http://127.0.0.1:${f.port}/`));
});
test("preparation failure still cleans up", async (t) => {
  const f = await fixture(t);
  f.brief.webCapture.prepare = ["exit 9"];
  const r = await captureWeb(f);
  assert.equal(r.ok, false);
  assert.equal(r.cleanedUp, true);
  assert.equal(r.pages.length, 0);
});
test("requires explicit setup/prepare/data/viewport and local URLs", async (t) => {
  const f = await fixture(t);
  delete f.brief.webCapture.prepare;
  await assert.rejects(() => captureWeb(f), /prepare/);
  f.brief.webCapture.prepare = [];
  f.brief.webCapture.pages[0].url = "https://example.com/";
  await assert.rejects(() => captureWeb(f), /loopback/);
});
test("each page uses its own synthetic browser state", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.repo, "server.mjs"),
    `import http from 'node:http';http.createServer((q,s)=>{s.end('<h1></h1><script>document.querySelector("h1").textContent=localStorage.getItem("stage")</script>')}).listen(${f.port},'127.0.0.1');`,
  );
  for (const stage of ["draft", "task"])
    await fs.writeFile(
      path.join(f.repo, stage + ".json"),
      JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: `http://127.0.0.1:${f.port}`,
            localStorage: [{ name: "stage", value: stage }],
          },
        ],
      }),
    );
  f.brief.webCapture.pages = ["draft", "task"].map((stage) => ({
    id: stage,
    url: `http://127.0.0.1:${f.port}/`,
    viewport: { width: 800, height: 600 },
    waitFor: `h1:text-is("${stage}")`,
    storageState: stage + ".json",
  }));
  const r = await captureWeb(f);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual(r.pages[0].sha256, r.pages[1].sha256);
});
test("an occupied readiness endpoint is rejected without killing its owner", async (t) => {
  const f = await fixture(t);
  const http = await import("node:http");
  const owner = http.createServer((q, s) => s.end("owned"));
  await new Promise((r) => owner.listen(f.port, "127.0.0.1", r));
  t.after(() => new Promise((r) => owner.close(r)));
  const r = await captureWeb(f);
  assert.equal(r.ok, false);
  assert.match(r.error, /occupied/);
  assert.equal(
    await (await fetch(`http://127.0.0.1:${f.port}/`)).text(),
    "owned",
  );
});
test("partial screenshots stay evidence while a later missing selector fails and cleans up", async (t) => {
  const f = await fixture(t);
  f.brief.webCapture.pages.push({
    ...f.brief.webCapture.pages[0],
    id: "missing",
    waitFor: ".missing",
  });
  f.brief.webCapture.timeoutMs = 600;
  const r = await captureWeb(f);
  assert.equal(r.ok, false);
  assert.equal(r.pages.length, 1);
  assert.equal(r.cleanedUp, true);
  assert.ok(await fs.stat(path.join(f.work, r.pages[0].file)));
});
test("browser close failure still stops services and saves a failed receipt", async (t) => {
  const f = await fixture(t);
  const { chromium } = await import("playwright");
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, "launch", async (...args) => {
    const browser = await launch(...args);
    const close = browser.close.bind(browser);
    browser.close = async () => {
      await close();
      throw Error("synthetic close error");
    };
    return browser;
  });
  const r = await captureWeb(f);
  assert.equal(r.ok, false);
  assert.match(r.error, /Browser cleanup failed/);
  assert.equal(r.cleanedUp, true);
  await assert.rejects(() => fetch(`http://127.0.0.1:${f.port}/`));
});
