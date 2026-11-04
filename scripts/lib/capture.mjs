import path from "node:path";
import { runCopy } from "./execute.mjs";
import { write } from "./io.mjs";
export async function capture(opts) {
  if (!/^[\w-]+$/.test(opts.id || ""))
    throw Error("capture requires a safe --id");
  if (!opts.command) throw Error("capture requires -- followed by a command");
  const result = {
    id: opts.id,
    ...(await runCopy(opts.repo, opts.command, { tty: !!opts.tty })),
  };
  await write(path.join(opts.work, "captures", opts.id + ".json"), result);
  return result;
}
