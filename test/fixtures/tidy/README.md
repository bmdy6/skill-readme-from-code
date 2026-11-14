# Authentic tidy fixtures

Each directory preserves README bytes from the squash merge commit and its first
parent. `source.json` records repository, PR, commits and Git blob IDs fetched
from GitHub. Tests recompute the blob IDs, so fixture edits cannot silently turn
a genuine failing example into a passing approximation.

`tidy.json` explicitly registers real editorial changes; section movement needs
no entry. Fixtures contain README text only, not the projects' local image assets.
Offline first-screen measurements therefore exercise the available text layout;
real image geometry must be inspected in the target repository.

jingwei #3, footage-mcp #6 and stylepolish #6 pass T1–T8. repo-tutor #3 retains
“第 1 轮 schema v1” and “本轮账号消费限制” in the actual merged README and fails
T7. The test asserts that failure, rather than changing authentic input or
weakening the shared V6 rule. Issue #26's acceptance criterion 1 remains unresolved.
