# ADR 0004: Do NOT honour `destructiveHint` — Chrome does not expose it

## Status
Accepted (as a rejection) — 2026-08-27

Attempted, measured, reverted. Recorded rather than deleted because the measurement is
the valuable part: it explains a limitation that looks like a bug in this fork and is not
one, and it stops the next agent repeating the attempt.

## Context

[ADR-0003](0003-content-js-exception.md) permitted exactly one edit to `content.js` —
idempotency — and closed with "anything else needs its own ADR." This was to be that ADR.

The **Destructive tool** concept (context.md) rests on a name heuristic:

```js
/(^|[-_])(submit|delete|purchase)([-_]|$)/i
```

`content.js` forwards two of the MCP `annotations` fields to the panel:

```js
readOnlyHint: tool.annotations?.readOnlyHint ? '✓' : undefined,
untrustedContentHint: tool.annotations?.untrustedContentHint ? '✓' : undefined,
```

The apparent defect was an asymmetry: a page can **clear** a tool with
`readOnlyHint: true`, but cannot **flag** one, because `destructiveHint` is not in that
list. `charge-card` gets no marker; a read-only `submit-feedback` gets a false one. The
obvious reading was that `content.js` was dropping the field on the floor, and the obvious
fix was to forward it.

## What was actually measured

The fix was implemented — tri-state forwarding (`'✓'` / `'—'` / `undefined`) in
`content.js`, precedence handling in `sidebar.js#isDestructive`, plus a
`destructiveHint` column in the Inspector table — and it did nothing. Chasing why produced
a fixture, `test/site/page3.html`, that registers four tools whose declarations and
heuristic verdicts deliberately disagree, and a probe reading `document.modelContext`
directly in the page's own world, upstream of the extension entirely:

```js
const tools = await document.modelContext.getTools();
Object.keys(tools.find((t) => t.name === 'charge_card').annotations)
// -> ["readOnlyHint", "untrustedContentHint"]
```

The page registered `annotations: { destructiveHint: true }`. `getTools()` returned an
`annotations` object with **two keys, neither of them `destructiveHint`**. In the same
run, `delete_draft`'s `readOnlyHint: true` came through fine — so annotations work; this
one field does not exist.

**`destructiveHint` is dropped by Chrome, not by `content.js`.** The Origin Trial
implements exactly two of the MCP annotation fields. Upstream forwards two hints because
two is all there is — the "arbitrary subset" was never arbitrary.

## Decision

Do not honour `destructiveHint`. Revert the forwarding, the precedence branches, and the
Inspector column.

- `content.js` keeps a two-line comment at the forwarding site recording *why* the list is
  short, so the next reader does not repeat this. `content.js` stays within ADR-0003's
  "under 15 changed lines" cap (now 14 insertions, 1 deletion).
- `sidebar.js#isDestructive` keeps `readOnlyHint` as authoritative and the name heuristic
  as the only other input, with the limitation stated in the docblock rather than implied.
- The fixture page and the probe **stay in the e2e suite as a capability canary**:

  ```
  OT exposes only readOnlyHint + untrustedContentHint on annotations
  ```

  It asserts the current, narrow reality. The day Chrome ships `destructiveHint`, that
  assertion goes red and points at this ADR. A canary that fails when the world *improves*
  is the right shape here — the alternative is a silent capability we never notice we
  gained.

Standing consequence, to be stated plainly rather than papered over: **annotations can
CLEAR a destructive marker but not SET one.** A page cannot flag its own dangerous tools
to this extension. That is a platform gap, not a fork defect.

## Alternatives considered

- **Keep the forwarding as dead code**, ready for the day Chrome ships the field. Rejected:
  `content.js` is the highest-churn file in the fork (34 upstream commits/12mo) and is
  already out of the merge-surface guard's protected set under ADR-0003. Paying permanent
  conflict risk on that file for code that cannot execute is the wrong trade. The canary
  brings us back here at the right moment, at zero merge cost.
- **Treat absent `destructiveHint` as destructive**, which is MCP's specified default.
  Rejected, and this one is worth being emphatic about: since Chrome exposes the field
  *never*, "absent" is 100% of tools, so the marker would be on for everything and carry
  no information at all. This was already the right call before the measurement; the
  measurement makes it unarguable.
- **Infer destructiveness from `untrustedContentHint`**, the other available field. No
  `content.js` change needed. Rejected: they describe opposite directions of data flow —
  untrusted *content* is about what a tool returns, destructive is about what it changes.
  Conflating them would be a worse lie than the heuristic.
- **Widen the heuristic** to cover more verbs (`send`, `charge`, `post`, `pay`). Not
  rejected on merit, just out of scope here and unmeasured. If it happens it needs real
  tool names to calibrate against, not guesses — `charge_card` was invented for a fixture,
  not observed on a live page.

## Consequences

**Easier:**
- `content.js` stays near-pristine; no dead branch to maintain across upstream merges.
- The limitation is written down in three places a reader will actually hit — the
  `isDestructive` docblock, `context.md#Destructive tool`, and a failing-when-fixed test —
  instead of being rediscovered by measurement each time.

**Harder:**
- The name heuristic is load-bearing indefinitely, with no page-side override to flag a
  tool it misses. False negatives on oddly-named destructive tools are unavoidable today.
- The canary asserts the *absence* of a feature, so it is expected to fail one day. That is
  intentional; do not "fix" it by loosening the assertion without reading this ADR.

**Future agents must NOT:**
- Re-add `destructiveHint` forwarding without first re-running the canary and confirming
  Chrome now exposes the field. The code was already written once and did nothing.
- Delete or weaken the canary to make a run green.
- Apply MCP's `destructiveHint: true` default for absent values.
- Read this as licence for other `content.js` edits. ADR-0003's idempotency exception is
  still the only permitted change; this ADR permits none.
