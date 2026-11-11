# Showcase style: loud, and every boast is checkable

Use when the user wants the README to sell the project: a portfolio piece, a
launch, or "make it look impressive". Set `brief.style: "showcase"`. The goal
changes from "a stranger can try it in ten seconds" to "a stranger decides in
five seconds that this is a serious project worth a star, then tries it".

The rule that makes this work: **a boast is a number, a demo or a contrast.**
Adjectives are not boasts. "Powerful search" is noise; "one query, five sources,
answers with the source line attached" is a boast, and the code can prove it.

## 1. Mine the repository for things worth bragging about

Before writing, read the code and list candidates in WORK/brag.json as
`{claim, number, factIds or captureId}`. Look for:

- **Counts**: sources, providers, commands, tools, templates, languages,
  platforms, checks, tests. Count them from code, not from the old README.
- **Zeros and ones**: zero config, zero runtime dependencies, one command, one
  file, no account, no API key, works offline. Only when literally true.
- **Measured numbers**: elapsed time from a real capture, binary/bundle size,
  lines of setup. Quote the capture, never a guess.
- **Hard engineering**: rollback, sandboxing, dry-run, version checks, retries,
  caching, type coverage, CI matrix. Anything a reviewer would respect.
- **Contrast**: what the user did by hand before (steps, tabs, copy-paste) and
  what it is now. The baseline is the manual workflow, not a named competitor
  unless `allowNamedAlternatives` is true.
- **Guarantees**: what the tool refuses to do (never deletes without confirm,
  never sends data out). Safety limits are selling points; state them proudly.

Pick the 3–4 strongest numbers for the stat row and the single strongest claim
for the tagline. Drop anything that needs a caveat longer than the claim.

## 2. Write it up the ladder

Rewrite every sentence at least one rung up; stop at the top rung the facts allow.

| Rung | Example |
|---|---|
| Label | Supports multiple search sources. |
| Fact | Searches GitHub, HN, Bilibili, Juejin and the web. |
| Number | 5 sources in one query. |
| Contrast | One query instead of five tabs. |
| Demo | (real captured output showing the five sources answering) |

Use strong verbs and short sentences. Lead with the result, then the mechanism.
Second person. Present tense. No hedging words (can help, aims to, tries to)
when the code does the thing unconditionally.

## 3. Structure

Follow templates/readme/showcase.md, in this order:

1. **Centered header**: logo or banner if the repo has one, name, a tagline of
   at most 12 words (40 Chinese characters), up to eight truthful badges, and a
   one-line nav (Quick start · Features · How it works · FAQ · language link).
2. **Hero**: the real coreAction input → output, as in write. This is the proof.
3. **Stat row**: 3–4 big numbers in a centered table, each from brag.json.
4. **Why**: two or three sentences of the pain, then a Before / After table of
   the manual workflow versus this project. Rows are concrete steps.
5. **Features**: 4–8 items in a two-column table. Emoji icon, bold result-first
   title, one sentence with the number or mechanism. Each maps to a fact ID.
6. **See it work**: one to three real captured examples, extra ones in details.
7. **Quick start**: at most three commands, then the first useful request.
8. **How it works**: a mermaid diagram of the real call path, three sentences.
9. **Built to be trusted**: tests, CI, safety limits, what stays local.
10. **FAQ and limits**, roadmap from real open issues only, contributing,
    license, and one closing line inviting a star.

Emoji headings are allowed, one per H2 at most. Body within wordBudget
(default 900). Paragraphs stay at three sentences or fewer.

## 3b. Make it look designed, not generated

The first image decides the impression. Build one **banner** that carries the
whole pitch, so a visitor who reads nothing else still gets it:

- Left: a small eyebrow label (what kind of thing it is), the name in large
  heavy type, the tagline with the key number marked by a highlighter stroke,
  one supporting sentence, and a plain list of integrations or sources.
- Right: a flat terminal or app window showing the **real captured run**, with
  the capture date in the window title. Use the actual field names and values.
- Bottom: the stat row as four big numbers under a rule, split by hairlines.

Style: flat and editorial, like a printed spec sheet. A paper-toned solid
background, near-black ink, one accent colour used sparingly, hairline borders.
Avoid the generic AI look: no dark purple/blue gradients, no glows, no glass
cards, no gradient text, no emoji icon tiles, no neon. If the project has its
own brand colours, use those as ink and accent. One variant per language works
on both GitHub themes.

Then one **feature grid** image: six cells in a ruled grid, each with a mono
index number (01–06), a result-first title and one sentence. Use it in place of
the features table.

Capture the real core operation as a small JSON summary. Use art's
`showcase-banner` template (docs/reference.md) with localized title, subtitle,
eyebrow, description, integration names, numeric `metrics[].field` paths and
scalar `outputFields`. Both the terminal projection and metrics come from the
same successful capture. Set `readmes` to the existing filename/language map:
`art --repo DIR --spec SPEC --work WORK --out DIR/docs/readme` renders four
variants, self-checks, hashes them and inserts or updates each marked README
banner with its caption and captured command. A failed image check does not
change README text. Keep the title/tagline in the banner's alt; do not repeat
them below the image. Put badges and the nav directly under the generated block.

The feature grid can still start from templates/showcase/features.example.html;
replace every string with this project's sourced facts and render with
`node scripts/showcase-shot.mjs FILE.html OUT.png`. Keep its HTML source beside
the image in docs/readme/showcase/. Prefer images below 400KB. PNG is supported;
WebP conversion remains optional and manual. Inspect the rendered page in light and dark before delivery: no wrapped
chips, no clipped terminal lines, numbers match brag.json.

## 4. Lines not to cross

- No invented stars, downloads, users, testimonials, logos or benchmarks.
- No best / fastest / first / #1 / only without a measured, linked comparison.
- No blazing fast, revolutionary, seamless, game-changing, next-generation.
- No "production-ready" or "enterprise-grade" unless tests and releases show it.
- No roadmap item presented as a shipped feature. No mockup presented as a run.
- Limits appear once, plainly, in FAQ. Do not bury them and do not repeat them.

Every stat, feature and Before/After row goes in claims.json with fact IDs or a
capture ID. If a boast cannot be traced, cut it or move down a rung.

## 5. Check the result

Verify runs as in write, with these differences under showcase: word budget 900,
up to eight badges, emoji headings allowed, and install may sit below the first
screen (name, tagline and hero must still be fully visible on desktop). Then read
the top 800px as a stranger and ask: what does it do, why is it better than doing
it by hand, and what number do I remember? If any answer is missing, revise.
