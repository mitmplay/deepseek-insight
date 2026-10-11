# Proven Gates — lessons from executed thin-shell runs

Each entry was paid for in a real run. Check every one during per-file
dsi-task waves; skip only with a stated reason.

## 1. `$effect` in `.svelte.ts` needs a root AND a teardown (Composer W1/W3)

A class constructor in a `.svelte.ts` module cannot call `$effect` bare —
outside component init it throws `effect_orphan`. Wrap the machine's
effects in `$effect.root(() => { ... })`, keep the returned stop function,
and expose `destroy()`; the shell calls it via `onDestroy`. Skip this and
unmount-time reads warn `derived_inert` — the machine's effects outlive
their component.

## 2. Census assertion per wave (Composer W1–W4)

Behavior-neutral extraction is proven by absence: after each wave, grep the
shell for the moved declarations (`$state` names, machine functions) and
assert **zero hits**. A grep hit on a prop KEY name (e.g. a gate key called
`helpVisible:`) is a false positive — verify the line, don't blind-count.
Record the count in the wave's completion notes.

## 3. Tests pass UNCHANGED — and failure attribution

If a pinned suite fails after an extraction, the FIRST suspect is the
extraction, but audit before reverting: test-side assumptions (fake DOM
elements missing methods, wrong type shapes vs the wire type, misread
grammar) get corrected with a written reason; production code does not move
to make a test green. This is dsi-task Step 3.5 applied.

## 4. Props/callbacks: live getters, never initial capture

When the shell passes a prop callback into a controller, pass a **getter**
(`get onpickcommand() { return onpickcommand; }`) — a direct reference
captures the initial value (svelte-check: `state_referenced_locally`) and
freezes the controller to mount-time wiring. This also keeps the
undefined-check semantics honest (BC-A3's no-callback early return).

## 5. Focus/caret fidelity is behavior

Re-focus paths are behavior, not plumbing: if the pre-move code queued a
microtask to set caret-to-end, the controller callback must replicate that
exactly (including the `== null` guard for a nulled `bind:this`); if it
focused directly, direct focus. Two different re-focus semantics need two
injected callbacks — do not unify them "while you're in there".

## 6. Neutral router exception (D2 amendment, 2026-10-10)

A keyboard/event ladder that arbitrates BETWEEN sibling machines may move
into its own `.svelte.ts` router only if it owns no surface and no draft —
constructed by the shell with the machines as deps. Never into a leaf
component or one of the arbitrated machines. Worked example:
`controller/keyboard-router.svelte.ts`.

## Worked example — the reference execution

ADR-0020 (dev/architectural-decission/2026-10/) + its spec folder
(dev/specs/2026-10/2026-10-10 - Composer Thin Shell/) + commits 65a1027 →
f4c1585 on `composer-thin-shell`: one file, four waves, suites unchanged at
every commit, census 1,269 → 822 lines. Lane sub-agents should read the ADR
and the wave completion notes before starting any file.
