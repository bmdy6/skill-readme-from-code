# Second-round evidence

This directory is the current R1–R6 evidence. Parent evidence files record round one.

- `verify.json`: full command results, first-screen checks, V10 provenance and V11 retention.
- `recognition-answers.json` and `blind-answers.json`: untouched fresh reader responses.
- `*-events.jsonl`: fresh `codex exec --ephemeral -s read-only --ignore-user-config` event streams; only attached images and questions were provided. No repository access or tool calls occurred.
- `blind-manifest.json`: cryptographic random draw and exact image hashes; `blind-result.json` records the scored choice.
- `report.md`: generated delivery report, with portable screenshot links.
- `../../design/round2/`: screenshots and the PR #8 visual baseline comparison.

Negative tests in `test/round2.test.mjs` (in readme-from-code) reject installation/check/README heroes, generic positions without artifacts, missing integrations/headings, and small/sparse art. `npm test` runs all existing tests too.
