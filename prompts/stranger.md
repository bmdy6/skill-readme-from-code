The independent reader receives only first-screen-desktop.png and questions.md.
It must not receive the repo, brief, claims, history, keyTerms or expected command.
Start a fresh read-only reader in an empty directory; disable tools where the
runtime supports that. A read-only filesystem alone is not an access restriction:
the reader must not inspect any files other than its supplied image/questions.
Use the generated questions. A shell install asks for firstCommand. A GUI
install asks for installLink (the visible label) and firstStep after downloading.
Both ask for what, forWhom, wouldTry (yes/no), why, whatOutput, mostAppealing and
confusing[].
Persist the reader's exact response, then run stranger score. Do not edit its
answers, add missing words or answer on its behalf. Record unavailable execution
as not-run with the actual error. Use one genuine first attempt; if the README
changes after failure, prepare the new image and use a fresh reader again.

Ask “What does the output look like?” and require a coreAction.output keyword
hit. For outputMatch: review, preserve the automatic failure and the untouched
answer. Record whether the reader described the right artifact in different
words. To test new terms, prepare a fresh run with a new brief and reader.
Ask “What appeals most?” and preserve the answer without grading it.
Use stranger blind-prepare to randomize old/new first screens into A.png/B.png.
Give another fresh reader only those two images and the neutral questions;
never give blind-manifest.json, the old/new mapping, expected choice or history.
Save its original JSON and score with stranger blind-score; only a win for the
new version passes. Archive failed attempts before revising and retesting.
