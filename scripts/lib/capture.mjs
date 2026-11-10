import fs from "node:fs/promises";
import path from "node:path";
import { runCopy } from "./execute.mjs";
import { write, hash } from "./io.mjs";
export async function capture(opts) {
  if (!/^[\w-]+$/.test(opts.id || ""))
    throw Error("capture requires a safe --id");
  if (!opts.command) throw Error("capture requires -- followed by a command");
  const result = {
    id: opts.id,
    kind: "command-run",
    role: opts.role || "supporting",
    ...(await runCopy(opts.repo, opts.command, {
      tty: !!opts.tty,
      timeoutMs: opts["timeout-ms"] === undefined ? 60000 : Number(opts["timeout-ms"]),
      outputs: opts.outputs
        ? String(opts.outputs)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      outputDir: path.join(opts.work, "capture-files", opts.id),
    })),
  };
  if (opts["input-file"]) {
    const base = await fs.realpath(opts.repo),
      input = await fs.realpath(path.resolve(opts.repo, opts["input-file"]));
    if (!input.startsWith(base + path.sep))
      throw Error("Capture input escapes repository");
    const bytes = await fs.readFile(input),
      file = path.posix.join("capture-inputs", opts.id, path.basename(input));
    await fs.mkdir(path.dirname(path.join(opts.work, file)), {
      recursive: true,
    });
    await fs.writeFile(path.join(opts.work, file), bytes);
    result.input = bytes.toString("utf8");
    result.inputFile = { file, sha256: hash(bytes) };
    result.usedFiles = [result.inputFile];
  }
  if (result.outputs)
    result.outputs = result.outputs.map((o) => ({
      ...o,
      file: path.posix.join("capture-files", opts.id, o.file),
    }));
  await write(path.join(opts.work, "captures", opts.id + ".json"), result);
  return result;
}
