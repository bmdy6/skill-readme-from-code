# Captured source-link example

Captured from [skill-design-from-sites](https://github.com/bmdy6/skill-design-from-sites) at 4dd4abe using its bundled site-a page and real main.css. The old reference is ../hero-link-reference.png. Data and styling are MIT-licensed original project fixtures.

`target-demo.mjs` is the exact adapter run as docs/readme/demo.mjs **inside that target clone**. It runs the actual collector, builds tokens, reads source verification, and creates a projected row array. Raw tokens.json and sources.json are preserved and hashed. projection-validation.json independently matches every displayed value to canonical tokens.json. No token values were authored in art.json.

Regenerate from this skill repository (no target UI tests or target application installation):

```sh
node scripts/run.mjs art --spec docs/design/hero-link/art.json --work docs/design/hero-link --out /tmp/hero-link-replay
```

This replays the saved evidence; it does not reopen the original temporary HTTP server. Source previews contain explicit ellipses; every complete line and file hash remains available. The provenance check validates all links against full source bytes, including declarations omitted from the preview.
