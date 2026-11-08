import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { files, hash } from "./io.mjs";
export async function runCopy(
  repo,
  command,
  {
    timeoutMs = 60000,
    tty = false,
    shareGitHubAuth = false,
    outputs = [],
    outputDir,
  } = {},
) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "readme-run-"));
  const cwd = path.join(temp, "repo"),
    home = path.join(temp, "home");
  await fs.mkdir(cwd);
  await fs.mkdir(path.join(home, ".local"), { recursive: true });
  try {
    for (const file of await files(repo)) {
      const to = path.join(cwd, file);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(path.join(repo, file), to);
    }
    // Dependencies are inputs, never a writable link back into the source repository.
    try {
      await fs.cp(
        path.join(repo, "node_modules"),
        path.join(cwd, "node_modules"),
        { recursive: true, dereference: true },
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const start = Date.now();
    const result = await new Promise((resolve) => {
      const env = {
        PATH: process.env.PATH,
        HOME: home,
        npm_config_prefix: path.join(home, ".local"),
        CI: "1",
        DO_NOT_TRACK: "1",
        DISABLE_TELEMETRY: "1",
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ||
          path.join(os.homedir(), "Library/Caches/ms-playwright"),
      };
      if (
        process.platform !== "darwin" &&
        !process.env.PLAYWRIGHT_BROWSERS_PATH
      )
        env.PLAYWRIGHT_BROWSERS_PATH = path.join(
          os.homedir(),
          ".cache/ms-playwright",
        );
      if (shareGitHubAuth) {
        env.GH_TOKEN = execFileSync("gh", ["auth", "token"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        env.GIT_CONFIG_COUNT = "1";
        env.GIT_CONFIG_KEY_0 = "credential.helper";
        env.GIT_CONFIG_VALUE_0 = "!gh auth git-credential";
      }
      const child = spawn("bash", ["-e", "-o", "pipefail", "-c", command], {
        cwd,
        env,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        timedOut = false;
      const append = (old, d) =>
        old.length < 2_000_000 ? old + d.toString() : old;
      child.stdout.on("data", (d) => (stdout = append(stdout, d)));
      child.stderr.on("data", (d) => (stderr = append(stderr, d)));
      const timer = setTimeout(
        () => {
          timedOut = true;
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        },
        Math.min(timeoutMs, 60000),
      );
      child.on("error", (e) => {
        stderr += e.message;
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolve({
          command,
          stdout,
          stderr,
          exitCode,
          signal,
          durationMs: Date.now() - start,
          timedOut,
          requiresTTY: tty,
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            ci: true,
            sharedGitHubAuth: shareGitHubAuth,
            stdin: "closed",
            isolation: "disposable copy; not an OS sandbox",
          },
        });
      });
    });
    if (outputs.length) {
      if (!outputDir)
        throw Error("Capture outputs require an output directory");
      result.outputs = [];
      for (const file of outputs) {
        const from = path.resolve(cwd, file),
          real = await fs.realpath(from);
        if (
          !real.startsWith((await fs.realpath(cwd)) + path.sep) ||
          path.isAbsolute(file) ||
          file.split(/[\\/]/).includes("..")
        )
          throw Error("Capture output escapes disposable repository");
        const bytes = await fs.readFile(real),
          to = path.join(outputDir, file);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.writeFile(to, bytes);
        result.outputs.push({ file, sha256: hash(bytes) });
      }
    }
    return result;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
