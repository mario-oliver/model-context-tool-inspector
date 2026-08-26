# Issue: Render the agent run as a Transcript of typed Events

## ID
`0001`

## Type
- Work: `AFK`
- Shape: `issue`

## Target repo
`model-context-tool-inspector`

## Contract (frozen)
- `context.md#Event` — the Event entity and its fields, verbatim field names.
- `context.md#The seam` — the exact edit surface in `sidebar.js`.
- `context.md#Transcript` — renders from the Event model only; never reads agent state.
- `docs/prd/assistant-mode-transcript.md` §Data decisions — the Event table.
- Changing the Event shape is an outer-loop decision. Stop and flag rather than extend it.

## Goal
The agent run renders as an ordered stream of typed Events instead of appended strings,
and the renderer is provably independent of Gemini. This is the tracer bullet: every
other issue in this epic hangs off the Event model landing correctly.

## Context
Upstream flattens all agent activity into `<pre id="promptResults">` via `logPrompt()`.
That surface can express "ran" and "threw" and nothing else — see PRD §Problem.
ADR-0002 establishes that `logPrompt()` is already the event bus with the types erased;
restoring the types is the whole job. `promptAI()`'s control flow does not change.

## Dependencies
- Blocked by: 0000 (baseline must be green before this runs — inner-loop Stage 0)
- Blocks: 0002, 0003, 0004

## Scope
- New `transcript.js`: Event types, an append-only Event store, and a renderer that
  mounts into a container element.
- `sidebar.js` seam edits only: rewrite `logPrompt()` to emit a typed Event; convert the
  six `logPrompt()` call sites (five in `promptAI()`, one in the `promptBtn.onclick`
  catch), the direct user-prompt append, and the Reset clear.
- `sidebar.html`: replace `<pre id="promptResults">` with the Transcript container.
- Event kinds: `user`, `assistant`, `toolCall`, `error`, `warning`. Status `ok` and
  `error` only.
- Preserve upstream's auto-scroll-on-append behaviour.
- **Merge-surface guard**: a script asserting the ADR-0001 invariant over the protected
  set — `styles.css`, `background.js`, `utils.js` — wired into the test run so it fails
  when violated. `content.js` is excluded per ADR-0003.
- e2e coverage in `test/e2e.mjs` for the `ok` path via the existing `add_numbers` fixture.

## Out of scope
- `lost` status, URL capture, duration — issue 0002.
- Expand-to-raw — issue 0003.
- Mode switch, header strip, rename — issue 0004.
- Chips, destructive flag — issue 0005.
- Any styling beyond making the Transcript legible. No `theme.css` yet.
- `promptAI()` control flow. `content.js` (issue 0000 owns it). `background.js`. `styles.css`. `utils.js`.

## Acceptance criteria
- [ ] (machine) `transcript.js` renders a hand-written fixture array covering all five
      Event kinds with **no API key set and no network access**.
- [ ] (machine) An agent run against `test/site/page1.html` produces a `toolCall` Event
      for `add_numbers` with `status: 'ok'` and the **verbatim** result string.
- [ ] (machine) A user prompt produces exactly one `user` Event; the final model text
      produces exactly one `assistant` Event.
- [ ] (machine) A thrown loop error produces one `error` Event (covers the
      `promptBtn.onclick` catch site, the sixth `logPrompt` call).
- [ ] (machine) Reset clears all Events and the rendered Transcript.
- [ ] (machine) `git diff upstream/main --name-only -- styles.css background.js utils.js`
      is **empty**. (`content.js` is excluded per
      [ADR-0003](../docs/adr/0003-content-js-exception.md); issue 0000 bounds its diff.)
- [ ] (machine) `test/e2e.mjs` collects zero console errors, and reports
      **15 passed, 0 failed** (the count issue 0000 establishes).
- [ ] (trust-prior-verify) The Transcript is readable at ~400px panel width. Rough is
      fine; polish is issues 0006/0007.

## Feedback Loops
```bash
cd test && npm install && npm test          # e2e: new Event assertions + existing upstream assertions
npm run guard:merge-surface                  # new: asserts zero diff on protected upstream files
```
Note: this repo has **no typecheck and no lint** (vanilla JS, no build step). The e2e
harness and the merge guard are the only automated gates available — do not add a
toolchain as part of this issue.

## Baseline ref
`<filled by the inner loop at preflight — base off 0000's merge>`

## Notes for agent
- `logPrompt()` is at `sidebar.js:397`; its call sites are at lines 236, 263, 265, 274,
  278, 280. The direct user-prompt append is at line 250; the Reset clear at line 299.
  Verify these line numbers before editing — they shift.
- Keep `logPrompt`'s name and signature. Renaming it enlarges the merge surface for no gain.
- `test/site/page1.html` registers `add_numbers` and `go_checkout`. Use `add_numbers` here.
- Add `guard:merge-surface` to the root `package.json` scripts; do not disturb the
  existing `postinstall` esbuild of `@google/genai`.
