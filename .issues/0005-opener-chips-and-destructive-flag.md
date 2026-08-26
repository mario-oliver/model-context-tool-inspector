# Issue: Surface reachable tools as chips, and mark the destructive ones

## ID
`0005`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md#Opener chip` — derived deterministically from `getTools()`, **never**
  model-generated.
- `context.md#Destructive tool` — name heuristic; **visual flagging only**, no
  interception, no gate, no confirmation.
- PRD §FR11, §FR12.

## Goal
Assistant mode shows one chip per tool registered on the current page, with destructive
tools visibly marked — so a missing chip reveals a registration bug before anything is
typed, and a submit-shaped tool is never fired unknowingly.

## Context
Chips double as a live readout of what the agent can reach, which is why they are
derived from `getTools()` rather than written by the model. Model-emitted confirmation
chips were considered and rejected (PRD §Non-goals): they duplicate a path that hides
arguments.

Destructive flagging is **awareness, not enforcement**. Dry-run interception was rejected
as loop surgery, and the residual risk is accepted and recorded: real submit tools on
optimizely.com are wired to real pipelines.

## Dependencies
- Blocked by: 0004
- Blocks: —

## Scope
- One chip per registered tool, from the tool data the panel already receives; clicking
  a chip populates the composer.
- Chips refresh when the registered tool set changes (upstream already wires
  `document.modelContext.ontoolchange` in `content.js` — consume it, do not modify it).
- Destructive detection by name heuristic: `*-submit`, `submit-*`, `delete`, `purchase`.
- Destructive marker on both chips and `toolCall` Events, using icon + text, not colour
  alone.
- Read WebMCP `annotations.destructiveHint` **first** when present, falling back to the
  heuristic. Treat annotations as possibly-absent; do not require them.

## Out of scope
- Interception, gating, confirmation, dry-run, simulated execution — all explicitly
  rejected. Implementing any of these violates ADR-0002.
- Copywriting chip labels. Use the tool name and its description as-is; mechanical
  phrasing is the accepted trade.
- Modifying `content.js` to add an annotations channel.

## Acceptance criteria
- [ ] (machine) Chip count and labels match the tools registered by
      `test/site/page1.html`, including tools from `test/site/frame.html`.
- [ ] (machine) Navigating to `test/site/page2.html` refreshes the chip set.
- [ ] (machine) A fixture tool named `*-submit` is flagged destructive; `add_numbers`
      is not.
- [ ] (machine) A fixture tool declaring `annotations.destructiveHint: true` with a
      non-matching name is flagged — proving annotations take precedence.
- [ ] (machine) A fixture tool declaring `annotations.destructiveHint: false` with a
      `*-submit` name is **not** flagged.
- [ ] (machine) Clicking a chip populates the composer and does **not** execute anything.
- [ ] (machine) No code path calls `executeTool` as a result of rendering or clicking a chip.
- [ ] (machine) Protected-file diff still empty; zero console errors.
- [ ] (trust-prior-verify) The destructive marker reads as a warning, not decoration.

## Feedback Loops
```bash
cd test && npm test
npm run guard:merge-surface
```

## Notes for agent
- You will need to extend `test/site/` fixtures with submit-shaped and
  annotation-bearing tools. New fixture files are fine — they are not upstream files.
- `content.js:83` already iterates `getTools({ fromOrigins })`; the panel receives that
  list. Consume what arrives rather than re-querying.
- The heuristic is a stopgap. Keep annotation-first / heuristic-fallback ordering so no
  rework is needed when pages start populating `annotations`.
