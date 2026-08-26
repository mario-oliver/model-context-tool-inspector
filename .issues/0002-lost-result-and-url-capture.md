# Issue: Distinguish a lost result from an error, with URL evidence

## ID
`0002`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md#Lost result` — `lost` is its own status, not a kind of `error`; rendering
  it as a failure is a correctness bug.
- `context.md#Event` — `status`, `urlBefore`, `urlAfter`, `durationMs`.
- PRD §FR8, §FR9.

## Goal
A tool call that executed but whose result was destroyed by navigation renders as
`lost` — visually distinct from `error` — and always shows its URL-before / URL-after
pair as evidence. This is the specific bug class the epic exists to expose.

## Context
Observed repeatedly against optimizely.com: `Cannot return tool results after a
cross-origin navigation`. The action succeeded and had side effects; only the return
value was lost. Rendered as a failure it reads as "nothing happened" — the opposite of
the truth. ADR-0002 records that URL capture needs **no `content.js` change**:
`sidebar.js` already holds `tab.id` and calls `executeTool` itself.

## Dependencies
- Blocked by: 0001
- Blocks: —

## Scope
- Wrap the **in-loop** `executeTool(tab.id, …)` call in `sidebar.js` to read the active
  tab URL immediately before and after, and to time the call.
- Classify a navigation-destroyed result as `status: 'lost'`.
- Populate `urlBefore`, `urlAfter`, `durationMs` on every `toolCall` Event.
- Render `lost` distinctly from `error`, with an icon **and** a text label, and always
  surface the URL pair on a `lost` Event without requiring expansion.

## Critical constraint — do not over-classify `lost`

**Upstream already recovers results across navigation in several cases, and those cases
pass today.** The baseline suite proves it:

- `cross-document result, script navigation` — PASS
- `cross-document result, form navigation` — PASS
- `cross-document result from new tab` — PASS
- `form tool with iframe target` — PASS

`content.js` does this via its `formTarget` / `targetFrame` logic. So `lost` is **not**
"the page navigated". `lost` is specifically "recovery was attempted and failed" — the
cross-origin case observed on optimizely.com.

Classifying any of those four cases as `lost` is a **regression**, not a feature. They
must still report `ok` with their real result. Assert this explicitly.

## Out of scope
- The second `executeTool` call site (Inspector mode's Execute button) — leave untouched.
- `content.js` — explicitly not needed; adding a message-protocol change here is a
  contract violation, stop and flag instead.
- Retry or recovery logic. This issue observes and reports; it does not fix the tools.
- Styling polish beyond the icon + label distinction.

## Acceptance criteria
- [ ] (machine) A call to the `go_checkout` fixture in `test/site/page1.html` — which
      navigates — classifies as `status: 'lost'`, **not** `'error'`.
- [ ] (machine) That same Event has `urlBefore !== urlAfter`, with both populated.
- [ ] (machine) A call to `add_numbers` classifies `ok` and has `urlBefore === urlAfter`.
- [ ] (machine) **All four cross-document / iframe-target cases still classify `ok`
      with their real result** — `script navigation`, `form navigation`, `from new tab`,
      `form tool with iframe target`. None may become `lost`.
- [ ] (machine) Every `toolCall` Event has a numeric `durationMs`.
- [ ] (machine) The rendered `lost` Event contains both URLs in its collapsed state.
- [ ] (machine) `lost` and `error` render different icons **and** different text labels
      — assert on the label text, not on colour.
- [ ] (machine) Protected-file diff still empty; suite reports 15+ passed, 0 failed.
- [ ] (trust-prior-verify) A `lost` Event communicates "it ran, the result vanished"
      without needing prose explanation.

## Feedback Loops
```bash
cd test && npm test
npm run guard:merge-surface
```

## Notes for agent
- `go_checkout` at `test/site/page1.html:37` is the natural fixture — it already
  navigates. You should not need to author a new fixture page.
- Detect `lost` from the thrown error's shape/message, but do not hard-match the full
  Chrome string — it will change. Match narrowly on the navigation signal and fall back
  to `error`.
- A same-origin reload can also destroy a result. If the fixture only covers
  cross-origin, note the gap in the PR rather than inventing a second fixture site.
