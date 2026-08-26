# Issue: Apply the chosen theme and fix the inherited CSS defects

## ID
`0007`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md#Tracking fork` — `styles.css` is **never** rewritten; override from
  `theme.css`, loaded after it.
- PRD §FR13, §FR15, §FR16.
- The direction chosen in issue 0006, as recorded in `context.md`.

## Goal
The chosen visual language ships as a `theme.css` override layer, with a working theme
toggle and the inherited defects corrected — without editing `styles.css`.

## Context
`styles.css` sees ~18 upstream commits/12mo, on our exact targets ("Add dark color
scheme", "Refactor font sizes to use rem units", "Change user prompt text font").
ADR-0001 therefore forbids editing it. Overrides must beat upstream's `!important` in
`.secondary` and the disabled-state rules — expect specificity work.

Three inherited defects to fix by override:
- Font stack leads with `Segoe UI`, a Windows font; on macOS it falls through to Verdana.
- No `color-scheme` declaration, so native scrollbars and form controls ignore the theme.
- `::placeholder` (`#a3a3a3` on white ≈ 2.3:1) and disabled text (`#9ca3af` on `#f3f4f6`)
  both fail WCAG AA.

## Dependencies
- Blocked by: 0006
- Blocks: —

## Scope
- New `theme.css`, linked after `styles.css` in `sidebar.html`.
- Design tokens as CSS custom properties; dark mode by **token redefinition**, not by
  restating rules.
- Manual theme toggle in the ⚙ menu, **layered over** `prefers-color-scheme` — explicit
  choice wins, system default still respected when unset. Persist via `localStorage`.
- Declare `color-scheme` so native controls follow.
- Font stack leading with `system-ui` / `-apple-system`.
- Raise `::placeholder` and disabled-text contrast to ≥ 4.5:1 in both themes.
- Delete the throwaway prototypes from 0006.

## Out of scope
- Editing, reformatting, or reordering `styles.css`. Not one line.
- Restyling Inspector mode.
- Upstreaming the defect fixes as PRs — worth doing, but a separate task.
- Adding a CSS build step, preprocessor, or framework.

## Acceptance criteria
- [ ] (machine) `git diff upstream/main -- styles.css` is **empty**.
- [ ] (machine) Computed `::placeholder` contrast ≥ 4.5:1 in light **and** dark.
- [ ] (machine) Computed disabled-text contrast ≥ 4.5:1 in light **and** dark.
- [ ] (machine) Computed `font-family` on `body` resolves to a system UI font, not Verdana.
- [ ] (machine) `color-scheme` is declared and reflects the active theme.
- [ ] (machine) Toggling theme changes rendered colours and survives panel reopen.
- [ ] (machine) With no explicit choice stored, the panel follows `prefers-color-scheme`
      in both directions.
- [ ] (machine) All four states (`ok`, `error`, `lost`, destructive) carry an icon **and**
      a text label in both themes — assert label text, not colour.
- [ ] (machine) No horizontal body scroll at 400px in either theme.
- [ ] (machine) `proto/` no longer exists.
- [ ] (machine) Protected-file diff still empty; suite reports 0 failed.
- [ ] (trust-prior-verify) Matches the direction chosen in 0006.

## Feedback Loops
```bash
cd test && npm test
npm run guard:merge-surface
```

## Notes for agent
- Upstream's dark block is `styles.css:304-429` — 125 lines restating rules. Do **not**
  delete it; override it. Your dark tokens must win against it, which may need
  `:root[data-theme]` specificity or matching the media query.
- `.secondary` uses `background-color: unset !important` and the disabled rules use
  `!important` on four properties. Plan for that.
- The `WebMCP` badge is the only place brand colour is permitted.
