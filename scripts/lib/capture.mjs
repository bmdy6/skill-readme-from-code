import path from "node:path";
import { runCopy } from "./execute.mjs";
import { write } from "./io.mjs";
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
      outputs: opts.outputs
        ? String(opts.outputs)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      outputDir: path.join(opts.work, "capture-files", opts.id),
    })),
  };
  if (result.outputs)
    result.outputs = result.outputs.map((o) => ({
      ...o,
      file: path.posix.join("capture-files", opts.id, o.file),
    }));
  await write(path.join(opts.work, "captures", opts.id + ".json"), result);
  return result;
}
