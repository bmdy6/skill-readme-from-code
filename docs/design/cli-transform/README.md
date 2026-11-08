# Captured CLI transformation

Actual [strip-json-comments-cli](https://github.com/sindresorhus/strip-json-comments-cli) output on an original three-line JSONC input. The upstream project is MIT-licensed; the example input is original. The command in captures/core.json calls the real cli.js entry point, and the input bytes/hash travel with the capture.

Regenerate from this skill repository:

```sh
node scripts/run.mjs art --spec docs/design/cli-transform/art.json --work docs/design/cli-transform --out /tmp/cli-transform-replay
```

The recorded output is accepted by JSON.parse. The compact comparison leaves room for installation and the first useful command in the README. No command transcript was hand-authored.
