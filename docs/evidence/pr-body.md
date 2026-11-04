# README delivery

Before: 80/100. After: 100/100.

![Before desktop](before/first-screen-desktop.png)

![Before desktop-dark](before/first-screen-desktop-dark.png)

![Before mobile](before/first-screen-mobile.png)

![After desktop](./first-screen-desktop.png)

![After desktop-dark](./first-screen-desktop-dark.png)

![After mobile](./first-screen-mobile.png)

## Verification

| Check | Status | Evidence |
|---|---|---|
| V1 | pass | Passed |
| V2 | pass | Passed |
| V3 | pass | Passed |
| V4 | pass | Passed |
| V5 | pass | Passed |
| V6 | pass | Passed |
| V7 | pass | Passed |
| V8 | pass | Passed |
| V9 | pass | Passed |

## Stranger

{
  "status": "pass",
  "checks": {
    "what": true,
    "forWhom": true,
    "firstCommand": true,
    "wouldTry": true
  },
  "answers": {
    "what": "An agent skill called readme-from-code that helps write a verifiable README with tested commands and clear images.",
    "forWhom": "Repository maintainers who use a skill-capable coding agent.",
    "firstCommand": "gh repo clone bmdy6/skill-readme-from-code .agents/skills/readme-from-code -- --branch feat/v0.1",
    "wouldTry": "yes",
    "why": "Tested commands and source-backed documentation sound useful, and the screenshot shows a concrete README excerpt.",
    "confusing": [
      "It does not explain which agents support the skill or how they discover it after cloning.",
      "The installation command targets a feature branch, which makes its stability unclear.",
      "The example image mostly repeats the installation command instead of demonstrating verified results.",
      "The prerequisites are cut off at the bottom of the screenshot."
    ]
  }
}

## Images

- hero-light.png: real; self-check pass
- hero-dark.png: real; self-check pass
- hero-light.zh-CN.png: real; self-check pass
- hero-dark.zh-CN.png: real; self-check pass
- workflow-light.png: illustration; self-check pass
- workflow-dark.png: illustration; self-check pass
- workflow-light.zh-CN.png: illustration; self-check pass
- workflow-dark.zh-CN.png: illustration; self-check pass

## Gates

G1: agent. G2: agent.

{
  "G1": {
    "decidedBy": "agent",
    "choice": "Evidence for maintainers",
    "reason": "Noninteractive acceptance authorized by issue #1."
  },
  "G2": {
    "decidedBy": "agent",
    "choice": "Approved after screenshot inspection",
    "reason": "Desktop light/dark show the entire command and hero; mobile recorded. Fixed dark code contrast before approval."
  }
}

## Not verified

- External links only checked when --online was requested.
- Renderer: github-api.
