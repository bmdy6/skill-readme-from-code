---
name: repo-storefront
description: Use when a user wants a GitHub README that makes strangers want to try and star the project — reads the code, writes a storefront README (plus a Chinese mirror if asked), and proves it by running every shell block in a sandbox and checking the rendered first screen.
---

# Repo storefront

The README is the project's shop window, not its manual. A visitor decides in about ten seconds. Within the first screen they must see four things: **what it is**, **who it is for and what they get**, **proof it works (an image)** and **one command to start**. Everything else moves to `docs/`.

Do not edit repository settings, push to the default branch, merge or publish. Produce files, a branch and suggestions; the user decides the rest.

## 1. Read (facts before words)

Read the manifest, entry points, tests, SKILL.md or CLI help, the existing README, docs and CI config. Also read the GitHub metadata (`gh api repos/OWNER/REPO`: description, topics, homepage). List each claim you might make together with the file it comes from. Never invent badges, numbers, benchmarks or features.

Look for things that constrain the README:
- tests that assert README content (`grep -r README test/`) — keep their intent; update them only if you keep the guarantee in both languages;
- existing screenshots or demo generators — reuse them before making new ones;
- placeholders such as `OWNER/REPO` and links that point nowhere.

## 2. Position (gate: user picks)

Ask at most three questions: who is it for, what do they use today, and what is the author proudest of. Read `prompts/position.md`. Offer three one-liners and a short "vs alternatives" table. Take competitors from the repo's own text first and state only facts you can check. **Wait for the user to choose.**

## 3. Show

Prefer evidence the project already produces. By project type:
- **CLI:** a terminal GIF (vhs).
- **Web or UI:** before/after screenshots or a step strip.
- **Library:** a five-line example that runs.
- **Agent skill:** "what you tell the agent → what you get".

Images must come from the project's own output or original fixtures. Never use third-party assets. When the image is generated, commit the script that generates it, so anyone can reproduce it.

## 4. Write

Read `prompts/write.md`. English is the primary language, in `README.md`. Add a mirror in `README.zh-CN.md` when asked; both link to each other. Move the manual (all flags, gates, exit codes, legal detail) to `docs/reference*.md`. Keep boundaries and legal notes on the homepage, folded into `<details>`.

## 5. Verify (all three must pass before a PR)

1. **Every shell block runs:**
   `node scripts/verify-commands.mjs --readme README.md --plan plan.json --out verify.json`
   Every block must be covered by the plan. To cover one, `run` it, give it an expected non-zero exit, or `skip` it with a reason. Uncovered blocks fail the check. If a command needs a TTY, document the non-interactive flags and verify those.
2. **The first screen sells:**
   `node scripts/first-screen.mjs --readme README.md --repo OWNER/REPO --out DIR`
   This renders the README with the GitHub Markdown API and checks name, one-liner, hero and install at 1280×800 and 390×844. Run it on the old README too, so the before/after goes in the PR.
3. **The project's own tests still pass.**

After pushing a branch, run `first-screen.mjs --github-url https://github.com/OWNER/REPO/tree/BRANCH` once. It reports how far down the real page the README starts.

## 6. Storefront extras (suggest only)

Suggest an About sentence, 5–8 topics and a social preview (1280×640) in the PR body. The user applies them in repository settings.

## Report

In the PR body, include: the before/after first-screen results, the command verification table (passed, skipped and why, any shared caches), the suggestions from step 6, and what was not verified.
