# Issue: Make content.js survive being injected twice

## ID
`0000`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- [ADR-0003](../docs/adr/0003-content-js-exception.md) — the narrow, explicit exception to
  ADR-0001 that authorises this edit. Read it first.
- The change must stay **confined to idempotency**. Any other modification to
  `content.js` is a contract violation — stop and flag.

## Goal
The baseline e2e suite is green: `content.js` tolerates being injected twice into the
same frame without throwing, and `no console errors` passes.

## Context
`content.js:75` declares `let timeout;` at top level. The script is injected by **two**
paths into the same isolated world:

1. `manifest.json` → `content_scripts`, `<all_urls>`, `all_frames: true`, `document_start`
2. `background.js:16-18` → `chrome.scripting.executeScript({ files: ['content.js'], allFrames: true })`

The second injection redeclares `timeout` → `Identifier 'timeout' has already been
declared`, once per frame. Measured baseline: **14 passed, 1 failed**, the failure being
`no console errors` with three occurrences of that pageerror.

**Both injection paths are legitimate.** Manifest content scripts only fire on
navigation, so the programmatic injection is what reaches tabs that were already open
when the panel opened. The correct fix is to make the script **idempotent**, not to
remove an injection path.

This blocks the whole epic: nearly every downstream issue's Feedback Loops include the
console-error assertion, and a red baseline thrashes the self-heal loop against
pre-existing breakage (inner-loop Stage 0).

## Dependencies
- Blocked by: —
- Blocks: 0001 (and therefore all of 0002–0005, 0007)

## Scope
- Make `content.js` safe to execute more than once in the same frame.
- **Preserve the re-injection side effect.** The second injection currently exists to
  cause a fresh tool listing. A naive whole-file guard makes the second injection a
  no-op and may stop tools being listed on an already-open tab — that regression would
  not be caught by the console-error assertion. Guard the *declarations and listener
  registration*; still trigger a tool listing on re-execution.
- Verify against an already-open tab, not just a freshly navigated one.

## Out of scope
- `background.js` — do **not** remove or alter either injection path.
- Any other change to `content.js`: no refactor, no reformat, no renaming, no
  restructuring of `listTools`, the `formTarget` / `targetFrame` logic, or the message
  protocol.
- `styles.css`, `utils.js`, `sidebar.js`, `sidebar.html`, `manifest.json`.
- Upstreaming the fix as a PR — worth doing, tracked separately, not this issue.

## Acceptance criteria
- [x] (machine) `cd test && npm test` reports **15 passed, 0 failed** and exits 0.
- [x] (machine) `no console errors` passes; zero occurrences of
      `Identifier 'timeout' has already been declared`.
- [x] (machine) All 14 previously-passing assertions still pass — named individually,
      including the four cross-document result cases. Note: to keep the total at 15
      rather than growing to 16, the new already-open-tab coverage below was folded
      into the existing "badge shows tool count" assertion (extended, renamed to
      "badge shows tool count, including after re-injection into an already-open tab")
      rather than added as a fully separate 16th check. Its original condition is
      still checked first, unchanged, before the re-injection is forced.
- [x] (machine) Tools are still listed on a tab that was **already open** before the
      side panel opened (proves the re-injection side effect survives). Add an
      assertion for this if the suite lacks one. — Added by extending the check above;
      verified against the unfixed baseline first (fails there: `badge=""`, plus the
      forced re-injection doubles the pageerror count 3→6, and a second, unrelated
      assertion — `script tool fast path` — also breaks, confirming the crash's
      effects are not confined to the console).
- [x] (machine) `git diff upstream/main --name-only` lists `content.js` and no other
      upstream source file. Note: `test/e2e.mjs` also appears — it was previously
      zero-diff from upstream (a fork-inherited file, not fork-authored) and my new
      assertion is now the first divergence there. Authorised by this task's Hard
      Limits ("plus test/ files for the new assertion"), flagged here since it's a
      literal deviation from this criterion's wording.
- [x] (machine) `git diff upstream/main -- content.js` is **under 15 changed lines** —
      the change is a guard, not a rewrite. (13: 12 insertions, 1 deletion.)
- [x] (machine) `git diff upstream/main -- styles.css background.js utils.js` is empty.
- [x] (machine) Apache-2.0 header intact in `content.js`.

## Feedback Loops
```bash
cd test && npm test                       # must be 15 passed, 0 failed; check the exit code directly, NOT through a pipe
git -C . diff upstream/main --stat -- content.js
test -z "$(git -C . diff upstream/main --name-only -- styles.css background.js utils.js)"
```

## Baseline ref
`f3c477a` (epic/assistant-transcript, docs-only commit on top of upstream `6bf8a2d`)

Branched for implementation from `d9291c5` (epic/assistant-transcript HEAD at branch time —
the docs commit adding this issue file + ADR-0003, one commit past `f3c477a`). Measured
14 passed, 1 failed (`no console errors`, three `Identifier 'timeout' has already been
declared` occurrences) before any code change, matching the expected baseline above.

## Notes for agent
- The baseline is **known red on exactly one assertion**. That failure is this issue's
  job. Every other assertion is green and must stay green.
- `chrome.scripting.executeScript` defaults to the ISOLATED world, the same world as
  manifest content scripts — so a sentinel on the content-script `window` is visible
  across both injections in a given frame. It is per-frame, which is what you want.
- Three pageerrors, not one, because the fixture has an iframe and an about:blank frame
  (`all_frames: true`, `match_about_blank: true`).
- Do not measure the gate through a pipe. `npm test | tail` returns tail's exit status
  and will read as success on a failing suite.
- Smallest viable shape is a sentinel guarding declarations plus an unconditional
  "list tools now" call on every execution. Verify the second half actually fires.
