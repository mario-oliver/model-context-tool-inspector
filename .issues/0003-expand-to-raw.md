# Issue: Expand any Event to its verbatim arguments and result

## ID
`0003`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md` §Governing principle — **calm by default, expandable to raw**. No
  mechanism discarded, only collapsed.
- `context.md#Proposed args / Sent args`.
- PRD §FR10.

## Goal
Every tool call Event collapses to a one-line summary and expands to the complete
underlying record, so no summary ever has to be trusted.

## Context
The failure modes here are partial — a tool that self-reports success while returning
stale content, or that reports `product: null` while the URL says `product=Opal`. Only
the verbatim result exposes those. Summarizing is the failure.

## Dependencies
- Blocked by: 0001
- Blocks: —

## Scope
- Collapsed: tool name, status icon + text label, duration, one-line argument précis.
- Expanded: declared `inputSchema`, `proposedArgs`, `sentArgs`, verbatim `result`,
  `frameId` / `origin`, `durationMs`, `urlBefore` / `urlAfter` when present.
- `proposedArgs` and `sentArgs` both always shown, even when identical; rendered as a
  diff when they differ.
- Expansion state is per-Event and does not reset on new Events arriving.
- Plumb `inputSchema`, `frameId`, and `origin` onto the `toolCall` Event from the data
  the tool list already provides.

## Out of scope
- Validating `proposedArgs` against `inputSchema` — deliberately **not** a requirement
  (see PRD §Non-goals; it was dropped in grilling). Do not add it.
- Editing arguments. Inspector mode is the replay tool.
- A syntax-highlighting JSON viewer. Plain `<pre>` with wrapping is sufficient.

## Acceptance criteria
- [ ] (machine) Expanding a `toolCall` Event yields the exact `sentArgs` JSON —
      assert **string equality**, not substring.
- [ ] (machine) Expanding yields the exact `result` string, byte-for-byte.
- [ ] (machine) `proposedArgs` and `sentArgs` both render when identical.
- [ ] (machine) `frameId` and `origin` are populated and rendered, including for a tool
      registered in `test/site/frame.html`.
- [ ] (machine) Expansion state survives subsequent Events being appended.
- [ ] (machine) Long results do not break panel layout — no horizontal body scroll at
      400px.
- [ ] (machine) Protected-file diff still empty; zero console errors.
- [ ] (trust-prior-verify) Collapsed state reads calm; expanded state reads complete.

## Feedback Loops
```bash
cd test && npm test
npm run guard:merge-surface
```

## Notes for agent
- `test/site/frame.html` exercises the cross-frame path; `content.js` already splits
  `frameId_name`, so the frame id is available without touching the content script.
- Upstream's `#toolResults` uses `white-space: break-spaces; word-break: break-all` for
  long output — reuse that approach rather than inventing one.
