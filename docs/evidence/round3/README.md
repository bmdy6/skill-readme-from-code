# Third-round evidence

Current F1–F3 results. Round2 evidence is historical.

Unit tests: 54 passed, none failed or skipped. See test-summary.json for this case’s verify, recognition and blind results.

**Recognition did not pass:** the unchanged forWhom keyword rule rejected the original reader response. The other four recognition checks passed. No response, expected keyword or scoring threshold was edited to make this pass. Both cases’ blind readers preferred the new version.

The attached images are round-three before (the round-two delivered version) and round-three after. Their SHA-256 hashes are preserved in blind-manifest.json. Raw answers and events are unchanged; event streams contain agent_message only, with no tool calls. The readers were separate fresh ephemeral read-only Codex exec sessions, given images and questions only.

The score caption’s absence/FAQ-only explanation, bilingual explanation and score-free paths are covered by test/round3.test.mjs in readme-from-code.
