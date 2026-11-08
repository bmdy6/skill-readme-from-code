import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { firstScreen, routeScreenRequest } from "../scripts/lib/screen.mjs";

const badge =
  '<svg xmlns="http://www.w3.org/2000/svg" width="110" height="20"><rect width="110" height="20" fill="green"/><text x="5" y="15" fill="white">working badge</text></svg>';

async function fixture(t) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    res.setHeader(
      "Content-Type",
      req.url.startsWith("/image") ? "image/svg+xml" : "text/plain",
    );
    res.end(req.url.startsWith("/image") ? badge : "remote content");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-screen-"));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, hits, origin: `http://127.0.0.1:${server.address().port}` };
}

test("P12 default screenshots load GET images and block other remote requests", async (t) => {
  const { dir, hits, origin } = await fixture(t);
  await fs.writeFile(
    path.join(dir, "README.md"),
    `# Fair\n\n<img src="${origin}/image.svg" alt="badge">\n<script src="${origin}/script.js"></script><link rel="stylesheet" href="${origin}/style.css"><iframe src="${origin}/frame"></iframe><script>fetch('${origin}/get'); fetch('${origin}/post', {method:'POST', body:'no'});</script>`,
  );
  const r = await firstScreen({
    repo: dir,
    work: path.join(dir, "screen"),
    local: true,
  });
  assert.equal(hits.filter((h) => h.url === "/image.svg").length, 3);
  assert.ok(
    hits.every((h) => h.method === "GET" && h.url === "/image.svg"),
    JSON.stringify(hits),
  );
  for (const viewport of Object.values(r.viewports)) {
    assert.equal(viewport.images[0].loaded, true);
    assert.equal(viewport.images[0].naturalWidth, 110);
  }
  assert.equal(r.remoteImages, "get-only");
});

test("P12 offline before and after use identical neutral placeholders without remote requests", async (t) => {
  const { dir, hits, origin } = await fixture(t);
  const results = [];
  for (const side of ["before", "after"]) {
    const repo = path.join(dir, side);
    await fs.mkdir(repo);
    await fs.writeFile(
      path.join(repo, "README.md"),
      `# Fair\n\n<picture><source media="(prefers-color-scheme: dark)" srcset="${origin}/image-${side}-dark.svg"><img src="${origin}/image-${side}.svg" alt="${side}"></picture>`,
    );
    results.push(
      await firstScreen({
        repo,
        work: path.join(repo, "screen"),
        offline: true,
      }),
    );
  }
  assert.deepEqual(hits, []);
  for (const r of results) {
    assert.equal(r.renderer, "local-marked");
    assert.equal(r.remoteImages, "neutral-placeholder");
    for (const v of Object.values(r.viewports)) {
      assert.equal(v.images[0].loaded, true);
      assert.equal(v.images[0].naturalWidth, 120);
    }
  }
  for (const name of Object.keys(results[0].viewports)) {
    assert.deepEqual(
      await fs.readFile(
        path.join(dir, "before/screen", results[0].viewports[name].screenshot),
      ),
      await fs.readFile(
        path.join(dir, "after/screen", results[1].viewports[name].screenshot),
      ),
    );
  }
});

test("P12 routing rejects non-GET images and GET non-image resources", async () => {
  for (const offline of [false, true]) {
    for (const [method, type, expected] of [
      ["GET", "image", offline ? "fulfill" : "continue"],
      ["POST", "image", "abort"],
      ["HEAD", "image", "abort"],
      ["GET", "script", "abort"],
      ["GET", "stylesheet", "abort"],
      ["GET", "document", "abort"],
      ["GET", "fetch", "abort"],
      ["POST", "fetch", "abort"],
    ]) {
      let action;
      await routeScreenRequest(
        {
          request: () => ({
            url: () => "https://example.invalid/resource",
            method: () => method,
            resourceType: () => type,
          }),
          continue: () => {
            action = "continue";
          },
          abort: () => {
            action = "abort";
          },
          fulfill: () => {
            action = "fulfill";
          },
        },
        { offline },
      );
      assert.equal(action, expected, `${offline} ${method} ${type}`);
    }
  }
});
