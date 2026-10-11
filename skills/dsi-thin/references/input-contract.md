# Input Contract — from dsi-sloc report to batch queue

The `dsi-sloc` report is the input, but it is a SNAPSHOT. This reference defines how to turn it into a verified, lane-paired queue.

## 1. Re-verify live

The report was measured at its date; commits since then change the numbers. For every candidate in the report table, re-run the per-file raw-code count (method: `skills/dsi-sloc/references/measurement.md` — the `sloc` analyzer, not `wc -l`).

- File now under threshold → drop silently (mention in one line: "already thin — fixed by commit X" if findable)
- File gone/renamed → drop with a note
- File grew → keep, use the new figure

## 2. Identify touchpoints per file

For each candidate, list the SHARED modules it will mutate or whose registry it will amend. Quick probes:

```bash
# who imports this file (its consumers)
grep -rn "from.*{file-basename}" src --include='*.ts' --include='*.svelte' -l

# which shared registries it touches
grep -n "floor-registry|panel-registry|dsh-connection|prompt" {file} | head
```

Record per file: consumers, shared-module mutations, registry amendments, test files that pin it.

## 3. Build the queue with lane pairing

The pool runs TWO lanes. Queue order must satisfy: **the two in-flight files never mutate the same shared module**.

- Sort by raw-code descending, then greedily pair A+B such that their touchpoint sets are disjoint; the pair ships to lanes a/b together, next pair waits.
- If a file collides with EVERYTHING (e.g. a change to `floor-registry.svelte.ts` itself, which every panel file touches), it becomes a **serial milestone**: pause lane b, run it alone on the batch branch, resume the pool after. Record the pause in the ADR.
- Present the pairing plan to the user with the curated list — the user may reorder by risk appetite instead.

## 4. The delta ledger

Every batch appends to the report file (or the batch ADR) a ledger:

| File | Raw before | Raw after | Waves | Excluded? |
|---|---|---|---|---|

Convergence rule: a file that drops below threshold leaves all future queues. The batch is done when the ledger's "after" column has no entry over threshold (or every remaining one carries a recorded exclusion).
