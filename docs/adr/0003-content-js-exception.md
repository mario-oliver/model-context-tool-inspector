# ADR 0003: Permit an idempotency fix in `content.js` as a narrow exception to ADR-0001

## Status
Accepted — 2026-08-26

## Context

[ADR-0001](0001-tracking-fork.md) forbids editing `content.js`, and the merge-surface
guard in issue 0001 asserts it stays zero-diff against upstream.

Preflight for the Assistant-mode Transcript epic measured the baseline e2e suite at
**14 passed, 1 failed**. The failure is `no console errors`, caused by an upstream bug:
`content.js:75` declares `let timeout;` at top level while the script is injected twice
into the same isolated world — once by `manifest.json` `content_scripts`, once by
`background.js:16-18` via `chrome.scripting.executeScript`. The redeclaration throws
`Identifier 'timeout' has already been declared`, once per frame.

This is not cosmetic. Nearly every issue in the epic includes the console-error
assertion in its Feedback Loops, and inner-loop Stage 0 requires stopping on a red
baseline rather than thrashing a self-heal loop against pre-existing breakage. The epic
cannot start with this unresolved.

Both injection paths are legitimate: manifest content scripts fire only on navigation,
so the programmatic injection is what reaches tabs already open when the panel opens.
Removing either would regress behaviour.

## Decision

Permit exactly one edit to `content.js`: making it **idempotent** under repeated
injection. Nothing else.

- The change is bounded to a re-execution guard plus preserving the re-injection side
  effect (a fresh tool listing). Issue 0000 caps it at **under 15 changed lines**.
- `background.js` remains untouched — both injection paths stay.
- The protected set asserted by the merge-surface guard becomes
  **`styles.css`, `background.js`, `utils.js`** — `content.js` leaves the zero-diff set
  but stays bounded by issue 0000's line-count criterion.
- The fix **should be offered upstream as a PR**. If upstream accepts it, this exception
  dissolves on the next merge and `content.js` returns to the protected set. That is the
  preferred end state.

## Alternatives considered

- **Narrow the gate instead** — change every issue's criterion from "zero console
  errors" to "no new console errors beyond a known baseline set". Preserves ADR-0001
  perfectly and unblocks immediately. Rejected by Mario: it leaves a real bug in place
  and makes every downstream issue's gate weaker and more conditional.
- **Drop the programmatic injection in `background.js`** — smaller-churn file (19
  commits/12mo vs 34). Rejected: it would stop tools being listed on already-open tabs,
  trading a console error for a functional regression.
- **Override and proceed on a red baseline** — rejected. Each subagent's leash forbids
  touching `content.js`, so the failure would be unfixable by design; agents would burn
  turns on it or breach scope.

## Consequences

**Easier:**
- A genuinely green baseline, so every downstream issue's gate means something.
- The console-error assertion stays absolute rather than becoming a maintained allowlist.

**Harder:**
- `content.js` (34 upstream commits/12mo) is now a permanent merge surface until
  upstream takes the fix. Expect occasional conflicts on merge.
- The merge-surface guard is one file weaker.

**Future agents must NOT:**
- Treat this as licence to make further `content.js` changes. The exception covers
  idempotency only; anything else needs its own ADR.
- Alter or remove either injection path in `background.js`.
- Re-add `content.js` to the guard's protected set until upstream has merged the fix.
