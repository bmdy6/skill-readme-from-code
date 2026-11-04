The independent reader receives only first-screen-desktop.png and questions.md.
It must not receive the repo, brief, claims, history, keyTerms or expected command.
Start a fresh read-only reader in an empty directory; disable tools where the
runtime supports that. A read-only filesystem alone is not an access restriction:
the reader must not inspect any files other than its supplied image/questions.
Ask for JSON: what, forWhom, firstCommand, wouldTry (yes/no), why, confusing[].
Persist the reader's exact response, then run stranger score. Do not edit its
answers, add missing words or answer on its behalf. Record unavailable execution
as not-run with the actual error. Use one genuine first attempt; if the README
changes after failure, prepare the new image and use a fresh reader again.
