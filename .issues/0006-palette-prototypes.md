# Issue: Choose the visual language from three throwaway prototypes

## ID
`0006`

## Type
- Work: `Human-in-the-loop`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md` §Governing principle — calm by default, expandable to raw.
- PRD §UX decisions — neutral surface; brand green is **not** the accent; `WebMCP` badge
  is the only branded element; four states must stay distinguishable.

## Goal
Mario picks the palette, spacing scale, and Event block composition from three
concrete throwaway prototypes. Taste is decided by a human, not inferred by an agent.

## Context
This is the original request — "take a pass at the CSS" — and it is the one part of the
epic that cannot be settled by acceptance criteria. The grill fixed the *constraints*
(neutral surface, no brand green as accent, never hue alone) and deliberately left the
*execution* open.

The hard constraint on all three: `error` versus `lost` must be unmistakable, because
they look adjacent and imply opposite actions.

## Dependencies
- Blocked by: 0004
- Blocks: 0007

## Scope
- Three visually distinct prototypes of the Assistant-mode Transcript, in a
  **throwaway** standalone HTML page with mock Events — not wired into the extension.
- Each renders the same fixture set: a `user` Event, an `assistant` Event, an `ok`
  toolCall, an `error` toolCall, a `lost` toolCall with URL evidence, a destructive-flagged
  toolCall, and one Event expanded.
- Each shown in light and dark.
- Vary meaningfully — surface treatment, block density, how status is expressed, how the
  expanded region is separated. Do not ship three tints of one idea.
- Mario picks one, or a hybrid, and the choice is recorded in `context.md`.

## Out of scope
- Wiring any prototype into the extension — that is issue 0007.
- Touching `styles.css`, `sidebar.html`, or `sidebar.js`.
- Building a design-token system. That comes with the chosen direction in 0007.

## Acceptance criteria
- [ ] (machine) Three prototypes exist as standalone pages, each rendering the full
      fixture set in both light and dark.
- [ ] (machine) No prototype file is referenced from `manifest.json`, `sidebar.html`, or
      `sidebar.js`.
- [ ] (machine) Protected-file diff still empty.
- [ ] (trust-prior-verify) **Mario has chosen a direction**, and the choice plus its
      rationale is written into `context.md`.
- [ ] (trust-prior-verify) In the chosen direction, `error` and `lost` are unmistakable
      at a glance, in both themes.

## Feedback Loops
```bash
npm run guard:merge-surface
# No automated gate for taste. This issue completes when Mario picks, not when tests pass.
```

## Notes for agent
- Prototypes are disposable. Optimise for contrast between the three options, not for
  code quality.
- Put them somewhere obviously temporary, e.g. `proto/`, and add it to `.gitignore` or
  delete it in 0007.
- Do not present a recommendation as a fait accompli — show all three fairly.
