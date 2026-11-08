# Command reference

Node >=20. ESM, no build. Install with `npm ci`, then run `node scripts/run.mjs
COMMAND`. Commands run from the installed skill directory. Paths can be absolute.
Use a trusted project: command execution uses disposable copies, not OS sandboxes.

## Shared options and exit codes

`--repo DIR` defaults to the current directory. `--work DIR` defaults to
`~/.cache/readme-from-code/<repository-basename>/`. Distinct repositories with
the same basename should use explicit work directories. `--brief FILE` selects
brief.json; otherwise it is read from work. Commands never write target files
except `art` when its output is explicitly selected in that target.

Exit 0: command completed (audit may have findings). Exit 1: verification, art
self-check, capture execution, or stranger score failed. Exit 2: invalid inputs,
missing files, setup or unexpected command error. No command merges, publishes,
changes settings or posts messages. The write workflow in SKILL.md is agent-led;
there is no automatic `write` CLI command.

| Command | Arguments | Outputs |
|---|---|---|
| doctor | none | Checks Node; installs Chromium when absent. |
| scan | --repo DIR | facts.json; deterministic with identical repository and metadata. |
| audit | --repo DIR [--online] [--local] [--deny-words FILE] | audit.json, audit.md, screen.html, first-screen.json and three screenshots. V2–V7 only; target untouched. |
| capture | --repo DIR --id ID [--tty] -- 'COMMAND' | captures/ID.json. 60 second cap, separate home, closed stdin, no inherited credentials by default. |
| art | --spec FILE [--out DIR] | PNGs and art-manifest.json; portable art.json and capture/screen inputs. Default out: target docs/readme. |
| verify | --repo DIR [--plan FILE] [--online] [--local] [--deny-words FILE] | verify.json, verify.md, screenshots. V1–V11; any failure exits 1. |
| stranger prepare | --repo DIR | stranger/first-screen-desktop.png, desktop-dark/mobile PNG, questions.md, result.json (not-run). |
| stranger score | --answers FILE or --not-run 'reason' | stranger/result.json. Five independent checks; confusing[] is preserved. |
| storefront | --repo DIR | storefront.md, social-light.png and storefront-art/. Suggestions only. |
| report | --repo DIR [--before DIR] | pr-body.md. Before defaults to work/before; absent evidence is not-run. |

`--online` checks HTTP(S) links with HEAD and a ten second timeout. Some sites
reject HEAD; inspect such findings. Offline V3 checks local files and Markdown
heading anchors using GitHub slug rules. External links are explicitly unchecked.
`--local` forces marked rendering; otherwise GitHub Markdown API is tried first,
with a documented fallback. The renderer adds a 72px header reserve. Desktop is
1280×800 with 838px content; mobile is 390×844 and informational. Desktop dark
uses the same dimensions. Remote image requests are blocked for reproducibility;
keep evidence images local. Badges are checked as text/URLs, not network proof.

## Facts and source evidence

facts.json contains projectType, manifest, install, entries, testCommands, spdx,
workflows, images, readmeTests, remote, optional metadata and facts. Each fact is
`{id, claim, value, source: "relative/file:line"}`. Manifest fields, license,
entrypoints, workflow paths, images and README-locking tests are discovered.
Project types: cli, library, web-app, agent-skill, other. Unknown licenses have
null SPDX; an agent must investigate instead of inventing a badge. v0.1 parses
Node manifests; other language commands require agent-supplied sourced facts.
readme-competitors.json may provide a string array of competitor terms. V6
excludes manifest dependencies from this list; --deny-words always applies.

Feature claims need agent inspection. Add `{id,claim,value,source}` to
work/facts.json after checking the actual code. Verification rescans structural
facts and also validates supplemental facts against their source file and line.
Supplemental `value` must be a nonempty string and a literal substring of the
specified source line. `source` is a repository-relative path plus a 1-based line
number. `id` and `claim` are nonempty strings; booleans, numbers, paraphrases,
blank values, wrong lines and paths outside the repository are rejected.

```json
[{"id":"copy-execution","claim":"Commands run in disposable copies.","value":"const temp = await fs.mkdtemp", "source":"scripts/lib/execute.mjs:11"}]
```

claims.json in target docs/readme contains an array:

```json
[{"claim":"Every command runs in a disposable copy.","factIds":["copy-execution"]}]
```

A claim must be present in a README, and every fact ID must exist. This proves
traceability; an agent must still review whether the cited line supports it.

## Brief and gates

```json
{
  "projectType":"agent-skill",
  "audience":"repository maintainers",
  "oneLiner":{"en":"Help maintainers write a README with evidence.","zh-CN":"帮助维护者写出有证据的项目介绍。"},
  "keyTerms":{"what":["readme"],"audience":["maintainers","developers","engineers","programmers","开发者","程序员"]},
  "install":{"command":"npx skills add bmdy6/skill-readme-from-code"},
  "firstUse":"Write a source-backed README for this repository.",
  "languages":["en","zh-CN"],
  "accent":"#2f6f4e",
  "wordBudget":400,
  "allowNamedAlternatives":false,
  "decidedBy":"agent",
  "gates":{"G1":{"decidedBy":"agent","choice":"Evidence first","reason":"Noninteractive acceptance"},"G2":{"decidedBy":"agent","choice":"Approved","reason":"Inspected all three screenshots"}}
}
```

Interactive G1 and G2 require user decisions. Noninteractive decisions must be
recorded individually and appear in the report. Do not infer approval from time.

Art headings that overflow after font loading shrink in 1px steps to a 16px
minimum. Overflow at that floor still fails the self-check; it is never hidden.
This adapts to local font metrics without requiring a bundled font family.

## Command plans and captures

work/command-plan.json contains `blocks`. Each rule selects exact `code` or an
`index` (zero based); optional `file` distinguishes languages. `expectExit`
defaults to 0. A `skip` string must explain why execution is unavailable. `tty`
records that a real TTY is required but does not allocate one. No silent command
rewrites, injected flags or success inferred from another command are allowed.
An explicit rule with shareGitHubAuth:true shares the current gh identity for a
private repository clone, through a temporary child environment and credential
helper. The report records sharedGitHubAuth without persisting its token. Use
this only when the user has authorized access to that private repository.

```json
{"blocks":[{"index":0,"expectExit":0},{"index":1,"skip":"Requires a user-owned test account."}]}
```

Bare, sh, bash, shell, console and zsh fenced blocks are executable examples.
Temporary copies omit .git, node_modules, .env and cache directories;
node_modules is separately copied if installed. No links point back to the
source. The temporary copy is removed after success, error or timeout. The
child process group is killed on timeout; output is capped at 2 MB per stream.
Capture JSON keeps command, stdout/stderr (including ANSI), exitCode, signal,
durationMs, timedOut, requiresTTY and a nonsecret environment summary. Do not
capture secrets: inspect both the command and outputs before committing them.

## Art data and reproduction

A spec has accent and images. Each image has unique id, template, localized title
and subtitle. Provide en and zh-CN for every authored text field. Terminal data
must use captureId. Capture lookup checks work/captures then the spec's sibling
captures directory. Art copies captures and screen inputs into its output.

```json
{"images":[{
  "id":"hero","template":"hero-prompt",
  "title":{"en":"Source-backed README","zh-CN":"有代码依据的项目介绍"},
  "subtitle":{"en":"Inspect the repository before writing.","zh-CN":"先检查代码，再写介绍。"},
  "prompt":{"en":"Write a README for this repo.","zh-CN":"给这个仓库写一份介绍。"},
  "captureId":"demo"
}]}
```

| Template | Extra data |
|---|---|
| hero-terminal | captureId required; command and stdout/stderr come from capture. |
| hero-prompt | prompt plus captureId, or illustration:true and localized result. |
| hero-code | captureId required; command → actual output. |
| hero-screens | screens: two original local image paths (or language maps). |
| strip-3 | steps: three localized strings; optional details of the same shape. |
| social | captureId, or illustration:true plus localized result. |

Pure diagrams require illustration:true and get a visible Illustration / 示意
label. Original fictional examples use fixture:true so the manifest distinguishes
fixture, real and illustration. Optional stats is an array of verify.json field
paths: summary.pass, summary.fail, summary.skip; numbers cannot be handwritten.
Screens are supplied assets, not browser captures. No external image downloads.

Regular images use 900 CSS px at 2x; social is the explicit 1280×640 export
exception. Naming: id-light.png, id-dark.png, id-light.zh-CN.png,
id-dark.zh-CN.png. Every PNG must be <1 MB. Self-checks inspect DOM overflow,
text >=13 CSS px, text contrast >=4.5, unresolved/missing fields and file size.
Manifest records hashes, source category, theme/language and detailed findings.
V9 checks the recorded passes and actual PNG hashes. It does not certify visual
quality: inspect light/dark and localized images yourself. Rerender after edits.
Reproduce gallery with `node scripts/gallery.mjs`.

## Verification and limitations

V1 executes every planned shell block in both languages. V2 measures the full
name, one-liner, hero and install block. V3 checks links. V4 checks alt, widths,
theme/language variants and orphaned docs/readme images. V5 checks placeholders,
badges, license, installation identity and claim references. V6 checks word and
sentence budgets, badges, emoji headings, superlatives and forbidden terms.
V7 checks heading structure/order, identical commands and corresponding images.
V8 runs discovered test commands in disposable copies; absent commands are skip.
V9 checks art self-checks and hashes. Audit only runs V2–V7.

V5 supports common SPDX licenses (MIT, Apache-2.0, GPL-3.0-only, BSD-3-Clause).
V7 recognizes bilingual skeleton section names and checks other translated headings structurally. A source citation is not a semantic proof. A desktop screenshot uses Markdown
rendered with GitHub styling and geometry, not a claim about every live browser
layout or authenticated repository UI. Test copies can use network; they are not
a malware boundary. No GIF recording, automatic web-app capture, settings
changes, publishing or CI drift checking are included in v0.1.

Stranger scoring requires normalized firstCommand equality, >=1 keyTerms.what hit
in what, >=1 keyTerms.audience hit in forWhom, and wouldTry exactly yes.
G1 fills audience synonyms and translations in the brief, not a code dictionary.
Legacy keyTerms arrays remain accepted as the shared terms for both checks.
It is a simple acceptance heuristic, not research on users' likelihood of starring. Keep the actual reader
response and confusing[]; no response means not-run. Reports do not suppress
failures or missing evidence.

## Replaying the recorded acceptance

The generated brief and command plan are committed in docs/readme. To replay,
pass --brief TARGET/docs/readme/brief.json and --plan
TARGET/docs/readme/command-plan.json to verify. The private clone plan explicitly
shares the already-authorized gh identity; no token is stored in these files.
Recorded reports are in docs/evidence. The self-install command installs main.


## Round 2 evidence contracts (R1–R6)

brief.coreAction is {what,input,command|agentStep,output:{description,keywords},
factIds}. The fact IDs identify the actual core operation. Hero capture role must
be core. V10 rejects install/test/lint/check/verify commands, a supporting capture,
and textual self-README previews. Core input → output must be a genuine run.
For LLM output, the agent runs the project's own instructions on original input;
kind: agent-run stores input, agentStep, usedFiles (file/sha256), response
(file/sha256/outputKey), stdout copied verbatim from that raw JSON response,
and optional measurements.score with a hashed measurements.source file.
Fixture before/after audit scores are checked against the stored audit JSON.
Use the explicit agent-generated caption; a mechanical style score is not a
human judgment of editing quality. Inputs and raw replies travel with art.json.
Screenshot artifact files explicitly referenced by the spec/capture are inputs,
not orphaned generated artwork. Full screenshots accompany any preview crop.

Facts have kind: integration for tools/platforms/runtimes and alternative for
competitors. Only alternatives are denied by default. The first scan preserves
baseline.json; commit it to docs/readme/baseline.json for portable V11 replay.
V11 checks every old H2 and integration in the new README or linked docs. An
intentional removal needs {id,reason} in retention.json intentionalDeletions;
heading IDs are heading:README.md:Original title. Report prints every removal.
A missing baseline is skip, never a claim of proven information retention.

Art uses auto height, 40px top/bottom padding, primary text >=16px, labels >=13px,
and content bounds >=60% of canvas area. Bounds include visible text, loaded
images and nonempty semantic cards, not the whole frame or empty boxes. V9
requires mainText and density passes in addition to the original checks.
Short terminal/code examples use a narrower canvas; social stays 1280×640.
The baseline comparison must be viewed at equal widths, including dark output.

Stranger answers add whatOutput (a coreAction.output keyword must appear) and
mostAppealing (recorded only). All five checks must pass. Use stranger
blind-prepare --before FILE --after FILE to save neutral A/B image copies,
questions, random order and hashes. The hidden mapping is in blind-manifest.json;
never send that mapping to the reader. stranger blind-score --answers FILE saves
the original answer and only passes if the new screenshot wins. Both modes need
fresh ephemeral read-only readers, images and neutral questions only.

Internal docs/superpowers material is excluded. Never merge automatically.

### Score captions

V10 requires an immediate README hero caption explaining any displayed score
with a calculation (for example, `Audit score = share of README checks passed`).
This applies to each README language, not only the FAQ. For agent-run voice
comparisons, measurements.before is `{score,source:{file,sha256}}`, while
measurements.score and source retain the actual polished score. Art shows
`Voice match X → Y`; V10 checks both saved checker outputs and their hashes.

## v0.2: linked artifacts and explicit execution

`hero-link` uses 900 CSS px and needs no title/subtitle: filenames, values,
source excerpts and a checked status are the content. Select it when the product's
value is the relationship between output and source. Keep the old strongest
promise and compare the same-width images before choosing a terminal instead.

```json
{"images":[{"id":"hero","template":"hero-link","captureId":"extract",
  "link":{
    "output":"capture-files/extract/tokens.json","outputPath":"entries",
    "source":"inputs/site.css",
    "items":[{"index":0,"name":"name","value":"value","line":"line"}],
    "focus":0,"status":{"from":"capture","path":"exitCode"}
  }}]}
```

`link.output` must appear in capture `outputs` or `usedFiles` as `{file,sha256}`;
its current bytes must match. `outputPath` selects an array. Each item selects an
integer `index` in that array and field paths for its `name`, `value`, and 1-based
`line`. No literal display values are accepted. For a separate sources.json,
add `source:{file,path}` to the item: the hashed capture file and selector of the
provenance record. `line` and optional `evidence` then select fields in that
record. Source lines must contain the displayed value or selected evidence
substring. Selectors accept dotted paths or RFC6901 pointers (use pointers for
keys such as `color.primary`). Up to six items, one zero-based `focus`.
`status:{from:"capture",path}` selects a scalar in the capture; alternatively
`{from:"verify",file:"verify.json",path:"summary.pass"}` reads a saved check.
Missing selectors or changed outputs fail before any PNG is created.

Rendering records hashes of every input and the actual source file, copies them
beside the portable spec, and shows cited source lines with one context line on
either side and `⋯` for omissions. Connectors are ordered by endpoints; the
focused path is drawn last with a separating halo. `links` checks the endpoints
inside both panels. V10 still requires role `core`; a successful installation
or a supporting/check capture remains ineligible.

`capture --outputs tokens.json,sources.json` collects those generated files from
the disposable execution **before cleanup**, preserving their bytes and hashes
under work/capture-files/ID. Set `--role core` for a core operation. Copy selected
capture files beside art.json before rendering. Source input files must also be
copied there. Do not reconstruct output data by hand.

All templates accept `resultLabel` as an en/zh-CN map; the default is neutral
Output / 输出. Density retains its 60% minimum but measures the union of actual
text-bearing element and loaded-image rectangles. Container-only cards and
empty boxes contribute nothing. `balance` needs at least 1:3 occupied area
between canvas halves. Sparse older specs can now fail and must be redesigned,
not blessed by their previous manifests. V9 requires balance and checks primary
font size at the actual desktop README display width, including dark picture
sources: `minMainFontSize × min(1, displayedWidth/cssWidth) >= 13px`. The 16px
export minimum remains; mobile is recorded as informational, as for V2.

```json
{"projectTests":{"skip":"User forbids target UI tests; npm test includes them."},
 "blocks":[{"index":0,"expectExit":0,"expectStdout":"Installed successfully"}]}
```

Use either `projectTests.skip` (nonempty reason, V8 skip, printed in reports) or
`projectTests.command` (one explicit command, its real exit decides V8). Both at
once and empty/non-string values fail. Without an override, discovered commands
still run. `expectStdout` is a regex string, **not** a shell command. A missing
match or invalid regex fails V1 even after exit 0. Interactive selectors without
a matched completion receipt produce warnings in V1 results and the report.

Stranger term matching normalizes English case, s/es/ies and hyphen/space forms
on both sides with word boundaries; Chinese text is not segmented or rewritten.
The exact first command is still compared with whitespace normalization only.
Questions, A/B randomization and wouldTry/choice requirements are unchanged.

Global npm installation examples use `npm_config_prefix` inside the disposable
home, so they never install into the host's global prefix. Each block still runs
in its own copy: a later block that depends on an earlier installation must be
explicitly skipped or made self-contained in the README, not silently rewritten.
Long source lines are rendered as explicit substrings with ellipses; all cited
evidence remains visible, and full source bytes/hashes travel with the spec.

`capture --input-file PATH` records the actual UTF-8 input bytes, a hash and a
portable inputFile. hero-code validates those bytes and uses them in the input
panel, rather than the capture command. Never author input text in art.json.
For brief CLI transformations, hero-code with compact:true keeps the two data
panels and omits repeated art title/caption. The README must still explain the
example and show the real first-use command. Keep install and first use visible.
