import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { audit, verify } from "./verify.mjs";
export async function dispatch(command, opts) {
  if (command === "doctor") {
    if (Number(process.versions.node.split(".")[0]) < 20)
      throw Error("Node >=20 required");
    try {
      const b = await chromium.launch();
      await b.close();
    } catch {
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../node_modules/playwright/cli.js", import.meta.url),
          ),
          "install",
          "chromium",
        ],
        { stdio: "inherit" },
      );
      const b = await chromium.launch();
      await b.close();
    }
    console.log("Node and Chromium ready");
  } else if (command === "capture") {
    const { capture } = await import("./capture.mjs");
    const r = await capture(opts);
    console.log(JSON.stringify(r, null, 2));
    if (r.exitCode !== 0 || r.timedOut) process.exitCode = 1;
  } else if (command === "art") {
    const { renderArt } = await import("./art.mjs");
    const r = await renderArt({
      ...opts,
      out: opts.out || path.join(opts.repo, "docs/readme"),
    });
    console.log(`${r.files.length} images rendered`);
    if (r.files.some((f) => Object.values(f.checks).some((s) => s !== "pass")))
      process.exitCode = 1;
  } else if (command === "audit" || command === "verify") {
    const r = await (command === "audit" ? audit : verify)(opts);
    console.log(
      JSON.stringify(
        {
          score: r.score,
          checks: r.checks.map((c) => ({
            id: c.id,
            status: c.status,
            issues: c.issues,
          })),
        },
        null,
        2,
      ),
    );
    if (command === "verify" && !r.ok) process.exitCode = 1;
  } else {
    const { delivery } = await import("./delivery.mjs");
    await delivery(command, opts);
  }
}
