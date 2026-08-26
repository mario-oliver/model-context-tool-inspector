# Issue: Give the panel two modes and its own identity

## ID
`0004`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md#Assistant mode`, `context.md#Inspector mode` — Assistant is default;
  Inspector is upstream's UI, **unchanged**, and is the project's replay tool.
- PRD §FR1, §FR2, §FR14, §FR17.
- Apache-2.0 notices must be retained (`context.md` §Attribution).

## Goal
The panel opens in Assistant mode, switches explicitly to an untouched Inspector mode,
carries the header strip, and identifies itself as "AI Agent in Browser".

## Context
Inspector mode must stay byte-identical in behaviour because it is upstream's code, its
churn surface, and the replay path that lets issue 0003 stay read-only. The header strip
is oversubscribed at ~400px, so preferences go into the existing popover dialog rather
than onto the strip.

## Dependencies
- Blocked by: 0001
- Blocks: 0005, 0006

## Scope
- Mode containers in `sidebar.html`; Assistant default on open; explicit switch only.
- Header strip: `[WebMCP]  [ Assistant | Inspector ]        [⚙]`.
- Reuse the existing `<dialog id="advancedSection" popover>` as the ⚙ overflow: move the
  API-key entry into it alongside the existing model radios and suggest-prompt checkbox.
  Retarget the existing `popovertarget` trigger; do not build a new menu.
- `manifest.json` `name` → `AI Agent in Browser`.
- Mode choice persists across panel opens via `localStorage`, consistent with how
  upstream already stores `model` and `apiKey`.

## Out of scope
- **Any** change to Inspector mode's markup, behaviour, or styling.
- Theme toggle placement and palette — issues 0006/0007. Leave the ⚙ menu ready for it.
- Chips — issue 0005.
- Removing or relocating the `Copy trace` / `Copy as JSON` / `Copy as ScriptToolConfig`
  actions.
- Changing `minimum_chrome_version`, permissions, or anything else in `manifest.json`.

## Acceptance criteria
- [ ] (machine) Panel opens in Assistant mode on first load.
- [ ] (machine) Switching to Inspector renders the tool table, tool `<select>`, Input
      Arguments textarea, and Execute Tool; executing a tool there still works.
- [ ] (machine) **Every existing upstream assertion in `test/e2e.mjs` still passes** —
      this is the proof Inspector mode is untouched.
- [ ] (machine) Mode never changes without an explicit user action.
- [ ] (machine) Mode selection survives a panel close/reopen.
- [ ] (machine) The ⚙ popover contains the model radios, suggest-prompt checkbox, and
      API-key entry, and opens without a console error.
- [ ] (machine) `manifest.json` differs from upstream **only** in `name`.
- [ ] (machine) Apache-2.0 headers present in every file that carried them upstream.
- [ ] (machine) Protected-file diff still empty; suite reports 0 failed.
- [ ] (trust-prior-verify) The strip does not feel crowded at 400px.

## Feedback Loops
```bash
cd test && npm test
npm run guard:merge-surface
git diff upstream/main -- manifest.json     # human-check: name line only
```

## Notes for agent
- `#advancedSection` and its `︙` trigger are at `sidebar.html:44-68`. `.menu-label` and
  `.model-option` styling already exists in `styles.css` — reuse the classes, do not
  restyle them.
- The API key currently uses `window.prompt()` at `sidebar.js:307`. Moving it into the
  dialog is in scope; if that turns out to require touching more than the button handler,
  leave `window.prompt()` in place and note it.
- Renaming the extension changes what Chrome shows above the panel and in the
  extensions list. Nothing else depends on the name.
