# Two-Lane Contract — the rolling pool of two sub-agents

The pool invariant: **exactly two lanes in flight while the queue is non-empty; the moment one finishes, the next queued file enters that lane.**

## Worktree isolation (why: two agents, one repo)

Two sub-agents in one working tree clobber each other: same dev-server port, same `test-results/`, same mid-edit files, one `git add` sweeps up the other's changes. So each lane gets its own worktree:

```bash
git worktree add .worktrees/lane-a -b lane-a batch-branch-start-commit
git worktree add .worktrees/lane-b -b lane-b batch-branch-start-commit
```

- Each lane's sub-agent prompt sets its cwd to its worktree root and works ONLY there.
- Each lane commits per wave inside its worktree (same commit message grammar).
- Worktrees are removed at batch close (`git worktree remove`).

## Lane lifecycle

```
dispatch(file)                     queue: [f1 f2 f3 f4]
  lane-a ← f1, lane-b ← f2         (2 in flight)
f1 done → merge lane-a → dispatch f3 to lane-a
f3 done → merge lane-a → dispatch f4 to lane-a   (queue empty)
f2 done → merge lane-b → pool drained
```

The dispatcher (this skill, in the main session) owns the queue; lane agents never pick their own next file.

## Merge gate (one lane at a time)

1. Lane reports waves green in its worktree.
2. Dispatcher merges THAT lane branch into the batch branch: `git merge --no-ff lane-a`.
3. Full suite re-run on the batch branch — must be green BEFORE the next merge.
4. Only then may the OTHER lane's finished work merge (it merges on top, resolving any registry-line conflicts — registry amendments are line-stable because each file's entry is contiguous).
5. The other lane, if mid-file, keeps working on its ORIGINAL base; it does NOT rebase mid-file. It re-bases before its NEXT file dispatch.

## Conflict budget

- Expected conflicts: floor-registry amendments (contiguous per-file blocks — trivial), Tasks/spec folders (per-file directories — none), package.json test counts in ADR text (docs).
- Unexpected conflicts in src code = the pairing rule failed. Stop the pool, resolve serially, record the pairing violation in the batch ADR as a rejected alternative.

## Failure recovery

- Lane agent fails a wave's gates twice → stop-the-line: that file exits the batch (excluded with reason in the ADR), lane takes the next file. The half-done worktree branch is kept as `lane-x-abandoned-{file}` for salvage, never merged.
- Batch branch suite red after a merge → the merge is reverted (`git revert -m 1`), the file goes through serial rework, pool pauses until green.
- Session dies mid-batch → recovery = re-derive state from: batch branch log (which waves committed), the todo list, and the ledger. Worktrees are rebuildable; committed waves are not lost.

## What lanes must NOT contain

- `git push` (dispatcher only, on user command)
- Registry amendments applied directly on the batch branch (they ride the lane branch, apply at merge)
- ADR edits (batch ADR is dispatcher-owned; lanes only REPORT their facts)
