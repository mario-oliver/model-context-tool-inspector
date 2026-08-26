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

## DOM contract (frozen — direction B was approved 2026-08-26)

The visual design is settled: **direction B, "Panel"**. Issue 0007 applies it as a
`theme.css` override. For that to be a pure styling pass, THIS issue must emit the
element/class skeleton below. Getting the structure right here is more important than
how it looks.

```
#transcript                              <- replaces <pre id="promptResults">
  .t-flow                                <- the ordered Event stream
    .t-user                              <- user message  (right-aligned when styled)
    .t-assist                            <- assistant prose
    details.t-ev.ok  |  .t-ev.err        <- ONE tool call = one <details>
      summary
        .who     "MCP"                   <- the WebMCP tag; makes tool calls scannable
        .tool    "✓ tool-name"           <- status icon + name
        .ms      "310ms"                 <- duration, tabular
        .chev    "▸"                     <- rotates when open
      .precis                            <- one-line argument precis, visible collapsed
```

Rules that follow from the design and are NOT negotiable here:
- **One `<details>` per tool call.** Native disclosure, no custom toggle JS.
- **Status carried by a class on `.t-ev`** (`ok` / `err`), never by an inline colour.
  0007 attaches the stripe to that class. The icon in `.tool` and the class must agree.
- Reserve, but do not populate, `.t-evidence` (issue 0002) and `.t-raw > dl.t-kv`
  (issue 0003) inside `.t-ev`. Leave `.t-chips` and `.t-composer` to 0004/0005.
- **The user must be able to follow the run by reading only the `.t-ev` rows.** Prose is
  the model talking; bordered rows are the machine acting. Do not merge the two.

Reference rendering: https://claude.ai/code/artifact/60b4b395-d747-42ec-83a8-b7d3ee863c4a

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
- [ ] (machine) On a run that completes, `test/e2e.mjs` reports **15 passed, 0 failed**
      with zero console errors. (Crashes with no summary line are the known flake.)
- [ ] (machine) The DOM contract above is emitted exactly: `#transcript`, `.t-flow`,
      `.t-user`, `.t-assist`, and `details.t-ev` with `summary > .who/.tool/.ms/.chev`
      plus `.precis`. Assert on the selectors.
- [ ] (trust-prior-verify) A reader can follow the run from the `.t-ev` rows alone,
      at ~380px. Unstyled is fine; direction B lands in 0007.

## Feedback Loops
```bash
cd test && npm test; echo "EXIT=$?"   # never pipe this; a pipe returns tail's status
npm run guard:merge-surface           # new: asserts zero diff on protected upstream files
```

**Known-flaky gate — read this before diagnosing anything.** `test/e2e.mjs` carries a
PRE-EXISTING upstream race in its cross-document waits. Roughly one run in three dies
with an uncaught `page.waitForFunction: Timeout 20000ms exceeded` in `waitSidebar`,
*before printing a summary line*. We have deliberately chosen not to fix it.

- A crash with **no `N passed, M failed` line** is the flake, NOT a failure of your work.
  Re-run, up to 3 attempts.
- A real failure is a printed `M failed` with M > 0. Only that requires diagnosis.
- Do not "fix" the flake, add retries to `e2e.mjs`, or raise its timeouts.
- Target on a completing run: **15 passed, 0 failed**.
Note: this repo has **no typecheck and no lint** (vanilla JS, no build step). The e2e
harness and the merge guard are the only automated gates available — do not add a
toolchain as part of this issue.

Preflight is already done on this branch: `js-genai.js` exists and `test/node_modules`
is installed. Do **not** run `npm install` in the repo root — its postinstall deletes
`node_modules` by design.

## Baseline ref
`adea603` (epic/assistant-transcript, 0000 merged)

## Notes for agent
- `logPrompt()` is at `sidebar.js:397`; its call sites are at lines 236, 263, 265, 274,
  278, 280. The direct user-prompt append is at line 250; the Reset clear at line 299.
  Verify these line numbers before editing — they shift.
- Keep `logPrompt`'s name and signature. Renaming it enlarges the merge surface for no gain.
- `test/site/page1.html` registers `add_numbers` and `go_checkout`. Use `add_numbers` here.
- Add `guard:merge-surface` to the root `package.json` scripts; do not disturb the
  existing `postinstall` esbuild of `@google/genai`.
