# Authentic tidy fixtures

Each directory preserves exact README bytes from the recorded Git commits.
`source.json` records repository, PR, commits and Git blob IDs fetched from
GitHub. Tests recompute the blob IDs to protect the authentic snapshots.

`tidy.json` explicitly registers real editorial changes; section movement needs
no entry. Fixtures contain README text only, not the projects' local image assets.
Offline first-screen measurements therefore exercise the available text layout;
real image geometry must be inspected in the target repository.

jingwei #3, footage-mcp #6 and stylepolish #6 use their squash merge commit's
first parent as before and the merge commit as after. repo-tutor uses PR #3's
parent (`30f5d5286357e7d0c07a5a226ce9e09bfe6004c1`) as before and PR #4's merge
commit (`ac40c5d4cbfa8ab37df0948d2f1fd4103a352096`) as after. `afterPr: 4` and
`structureCommit` distinguish the editorial cleanup from PR #3's structure change;
its manifest registers both sentence rewrites with reasons. All four pass T1–T8.

`repo-tutor-worklog/` retains PR #3's original merge result
(`b58c6e6a5bdf65ee7e2bc800baeffde950ee3bd9`), original baseline and original
manifest as a separate negative fixture. It retains “第 1 轮 schema v1” and
“本轮账号消费限制” and must fail only T7, preserving the strict shared V6 rule.
