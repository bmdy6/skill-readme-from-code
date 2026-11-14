#!/usr/bin/env node
import path from "node:path";
import { scan } from "./lib/scan.mjs";
import { write, workdir, exists } from "./lib/io.mjs";
const argv = process.argv.slice(2),
  command = argv.shift(),
  opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--") {
    opts.command = argv.slice(i + 1).join(" ");
    break;
  }
  if (!argv[i].startsWith("--")) {
    opts.action = argv[i];
    continue;
  }
  const k = argv[i].slice(2);
  opts[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
}
opts.repo = path.resolve(opts.repo || ".");
opts.work = path.resolve(opts.work || workdir(opts.repo));
try {
  if (command === "scan") {
    const result = await scan(opts.repo);
    await write(path.join(opts.work, "facts.json"), result);
    if (!(await exists(path.join(opts.work, "baseline.json"))))
      await write(path.join(opts.work, "baseline.json"), result.readmeSnapshot);
    console.log(JSON.stringify(result, null, 2));
  } else if (!command || command === "help") {
    console.log(
      "scan     → source facts\ntidy baseline/verify → organize structure, preserve prose\nillustrate baseline/verify → preserve text, validate added images\ncapture  → real command or --type web-app output\nart      → light and dark images\nverify   → commands, links and first screen",
    );
  } else {
    const { dispatch } = await import("./lib/commands.mjs");
    await dispatch(command, opts);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
}
