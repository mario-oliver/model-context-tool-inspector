# PRD: Assistant mode — the Transcript

> The destination. Uses the ubiquitous language from `context.md`. Written after
> grill-with-docs (2026-08-26); broken into issues by prd-to-issues.
>
> Governing constraints: [ADR-0001](../adr/0001-tracking-fork.md) (tracking fork),
> [ADR-0002](../adr/0002-logprompt-seam.md) (the seam).

## Problem

This repo is a fork of upstream's Model Context Tool Inspector, kept for one job:
**debugging WebMCP tool registrations** on real pages.

Upstream's UI cannot do that job. All agent activity is flattened into strings by
`logPrompt()` and appended to a single `<pre id="promptResults">`. That surface can
express "it ran" and "it threw" and nothing else — but the failure modes that matter
here are **partial**, and every one of them is invisible in a two-state view.
Observed against optimizely.com:

- A search tool reported success while returning **stale results from a previous
  query** — the page had silently navigated to the homepage with a truncated query.
- Tool calls repeatedly failed with `Cannot return tool results after a cross-origin
  navigation`: the action **succeeded and had side effects**, but the return value was
  destroyed by the page reload. Rendered as a failure, this reads as "nothing
  happened" — the opposite of the truth.
- A tool's own read-back reported `product: null` while the page URL said
  `product=Opal`, so the tool under-reported its own state.

None of these are diagnosable from upstream's `<pre>`. The instrument cannot see the
bugs it exists to find.

## Goal

An **Assistant mode** whose **Transcript** renders typed **Events** — calm by
default, expandable to raw — such that a partial failure is legible at a glance and
fully inspectable on click.

Achieved **without modifying the agent loop** and **without breaking the tracking
fork**, so upstream's spec-tracking fixes keep arriving by `git merge`.

## Non-goals / Out of scope

Preserved from grilling. Each was considered and deliberately rejected; re-adding any
breaks ADR-0001 or ADR-0002.

| Rejected | Why |
|---|---|
| **Confirmation gate / step mode** — pause before each tool call | Changes `promptAI()` control flow. Its diagnostic value is available post-hoc from the Event record; it protected against side effects, not ignorance. |
| **Edit-args at a breakpoint** | Inspector mode already provides tool select + editable Input Arguments + Execute. That *is* replay. |
| **Dry-run / simulated execution** of Destructive tools | Loop surgery. Replaced by visual flagging only. **Accepted residual risk**, recorded below. |
| **Model-emitted confirmation chips** | A second confirmation path that hides arguments — duplicative and less informative than the Event record. |
| **Cards / schema-driven forms replacing the tool table** | Forks `sidebar.js`'s render path (64 upstream commits/12mo). Deferred, not dismissed — needs its own cycle. |
| **`content.js` URL capture** | Unnecessary. `sidebar.js` holds `tab.id` and calls `executeTool` itself. |
| **Restyling or restructuring Inspector mode** | Upstream's code and upstream's churn surface. |
| **Rewriting or restructuring `styles.css`** | 18 upstream commits/12mo on our exact targets. Override from `theme.css` instead. |
| **Rewriting `promptAI()`** | The 64-commit file. |
| **Touching `content.js` or `background.js`** | Merge surface, no benefit. |

Also out of scope: publishing to the Chrome Web Store; any change to
`~/Code/web-mcp/` (the `annotations` product action item is tracked there, separately).

## Users

**Mario**, debugging his own WebMCP tool registrations against real pages. Single
user, local unpacked extension. Not a consumer assistant and not a demo prop — where
consumer polish and diagnostic legibility conflict, legibility wins.

## User stories

- As a tool author, I want each tool call rendered as its own block with a status,
  so that I can see the shape of an agent run without reading a wall of text.
- As a tool author, I want to expand any tool call to its **verbatim** arguments and
  result, so that I never have to trust a summary.
- As a tool author, I want a call that ran but lost its result to be visually
  distinct from one that threw, so that I don't conclude "nothing happened" when
  side effects are real.
- As a tool author, I want the page URL before and after each call, so that I can
  detect a tool that navigated when it shouldn't have.
- As a tool author, I want one **Opener chip** per registered tool, so that a missing
  chip tells me about a registration bug before I type anything.
- As a tool author, I want **Destructive tools** visibly marked, so that I know which
  chips submit real forms into real pipelines.
- As a tool author, I want the raw tool table still available, so that I can re-run a
  call with corrected arguments.
- As the maintainer, I want upstream fixes to keep merging cleanly, so that I am not
  hand-porting spec changes while WebMCP is still in Origin Trial.

## Functional requirements

**FR1 — Mode switch.** Two modes, **Assistant mode** and **Inspector mode**, via an
explicit switch. Assistant is the default on panel open. Never switches automatically.

**FR2 — Inspector mode is unchanged.** The existing tool table, tool `<select>`, Input
Arguments textarea, Execute Tool button, and Copy-as-JSON / Copy-as-ScriptToolConfig
actions render and behave exactly as upstream. It is the project's replay tool.

**FR3 — Transcript.** Assistant mode renders an ordered stream of Events, replacing
`<pre id="promptResults">`. Renders from the Event model only; never reads agent state
directly. Cleared by the existing Reset control. Auto-scrolls as upstream does.

**FR4 — Event emission at the seam.** All Events originate from the seam and nowhere
else: six `logPrompt()` call sites (five in `promptAI()`, one in the
`promptBtn.onclick` catch), the direct user-prompt append, and the Reset clear.
`promptAI()`'s control flow is unchanged.

**FR5 — Event kinds.** user message, assistant text, tool call, error, no-text
warning — mapping 1:1 onto the boundaries the loop already crosses.

**FR6 — Tool call Event fields.** See Data decisions.

**FR7 — Status is three-valued.** `ok` / `error` / `lost`. `lost` is **not** a kind of
`error`. Never a boolean.

**FR8 — Lost result detection.** A tool call whose failure indicates the result was
destroyed by navigation (e.g. `Cannot return tool results after a cross-origin
navigation`) is classified `lost`, rendered distinctly from `error`, and **always**
shows its URL-before / URL-after pair as evidence.

**FR9 — URL capture.** `sidebar.js` reads the active tab URL immediately before and
after the in-loop `executeTool(tab.id, …)` call, plus call duration. No content-script
change, no new permission.

**FR10 — Collapsed / expanded.** Collapsed shows tool name, status icon + text label,
duration, and a one-line argument précis. Expanded shows the declared `inputSchema`,
**Proposed args**, **Sent args**, verbatim result string, `frameId` / origin, duration,
and URL before / after.

**FR11 — Opener chips.** One chip per tool from `getTools()`, derived
deterministically. Never model-generated. Refreshes when the registered tool set
changes.

**FR12 — Destructive tool flag.** Name heuristic (`*-submit`, `submit-*`, `delete`,
`purchase`) marks chips and Events visually. **Flagging only — no interception, no
gate, no confirmation.** When a page populates WebMCP `annotations`
(`destructiveHint`), read that first and keep the heuristic as fallback.

**FR13 — Never hue alone.** Every status carries an icon and a short text label.

**FR14 — Header strip.**
`[WebMCP]  [ Assistant | Inspector ]        [⚙]`
The gear opens the existing `<dialog id="advancedSection" popover>`, extended with
the theme control and API-key entry alongside the existing model radios and
suggest-prompt checkbox.

**FR15 — Theme.** Neutral (near-achromatic) surface. Manual theme toggle layered over
`prefers-color-scheme`, not replacing it. Declares `color-scheme` so native scrollbars
and form controls follow the theme. Retains the `WebMCP` badge as the only branded
element.

**FR16 — Defect fixes, by override.** Font stack leading with `system-ui` /
`-apple-system` rather than Segoe UI (which falls through to Verdana on macOS);
`::placeholder` and disabled-text contrast raised to ≥ 4.5:1.

**FR17 — Rename.** `manifest.json` `name` → **"AI Agent in Browser"**. Apache-2.0
notices retained in every file that carries them; upstream's "not an officially
supported Google product" disclaimer kept and attributed.

## Data / schema decisions

No persistence, no migrations. One in-memory entity.

**Event** — the renderer's entire input contract.

| Field | Notes |
|---|---|
| `kind` | `user` \| `assistant` \| `toolCall` \| `error` \| `warning` |
| `seq` | monotonic ordering |
| `text` | for `user` / `assistant` / `error` / `warning` |

**Tool call Events additionally carry:**

| Field | Notes |
|---|---|
| `toolName` | as reported by the loop |
| `frameId`, `origin` | loop already splits `frameId_name` |
| `inputSchema` | declared schema, for the expanded view |
| `proposedArgs` | args the model produced |
| `sentArgs` | args actually passed; recorded even when identical |
| `result` | **verbatim** result string, never summarized |
| `status` | `ok` \| `error` \| `lost` |
| `errorMessage` | when `error` or `lost` |
| `durationMs` | |
| `urlBefore`, `urlAfter` | captured around the in-loop call |
| `destructive` | boolean, from the name heuristic |

`proposedArgs` and `sentArgs` can differ **only** via Inspector-mode replay. Nothing
in the agent loop rewrites arguments.

## UX decisions

- **Governing principle: calm by default, expandable to raw.** Conversational visual
  language; no mechanism discarded, only collapsed.
- Neutral surface. Rationale: four states must stay distinguishable at a glance —
  `ok`, `error`, `lost`, and the `destructive` marker — and `error` versus `lost` is
  the pair that matters most, since they look adjacent and imply opposite actions. A
  saturated surface spends chromatic contrast on decoration and leaves status colours
  fighting the background.
- **Brand green is not the accent.** In a debugging tool green means *passed*; making
  it also mean *Optimizely* guarantees misreading. Brand presence is confined to the
  `WebMCP` badge.
- Kept from the reference mock: rounded Event blocks, pill buttons, right-aligned user
  bubbles, the badge, a theme toggle. Dropped from it: navy saturation, mid-conversation
  confirmation chips, and the implied rename to "AI assistant".
- Theme control lives in the ⚙ menu, not on the strip — set once, and the strip is
  scarce at ~400px panel width.
- Taste-sensitive: the exact palette, spacing scale, and Event block composition are
  expected to be prototyped as issues rather than fixed here.

## Implementation decisions

- **New files carry the work:** `transcript.js` (renderer), `theme.css` (styling).
  New files never conflict.
- `theme.css` is loaded **after** `styles.css`. `styles.css` is never edited. Overrides
  must beat upstream's `!important` in `.secondary` and the disabled-state rules.
- **Edit surface, and nothing else:**
  - `sidebar.js` — the seam (six `logPrompt()` sites, user-prompt append, Reset clear)
    plus a wrapper on the **in-loop** `executeTool(tab.id, …)` call. The second
    `executeTool` call site, behind Inspector mode's Execute button, is untouched.
  - `sidebar.html` — header strip markup, mode containers, `<pre>` → Transcript
    container, `theme.css` link, theme + API-key controls into the existing dialog.
  - `manifest.json` — `name` only.
- `content.js`, `background.js`, `styles.css`, `promptAI()` control flow: **untouched**.
- No build step is introduced. Upstream's `postinstall` esbuild of `@google/genai`
  into `js-genai.js` stays as-is.
- **Accepted residual risk:** Destructive tools are live and unguarded. Named
  explicitly — `optimizely-…-lead-form-submit`, `optimizely-…-demo-request-submit`,
  `optimizely-…-become-a-partner-inquiry-submit`, and in the v8 build
  `…-register-opticon-online-submit`. Visual flagging is the only mitigation.

## Testing decisions (Feedback Loops)

The existing harness is the loop: `test/e2e.mjs` (Playwright, loads the unpacked
extension into real Chrome, serves `test/site/` fixtures, collects assertions via
`check(name, cond, detail)`), run with `npm test` in `test/`.

**Machine-verifiable — must pass:**

1. **Renderer is Gemini-free.** `transcript.js` renders a fixture array of Events with
   no API key and no network. Every Event kind and all three statuses render.
2. **`lost` ≠ `error`.** `test/site/page1.html` already registers **`go_checkout`,
   which navigates** — the natural fixture. A call to it must classify as `lost`, not
   `error`, and must render its URL-before / URL-after pair.
3. **`ok` path.** `add_numbers` in the same fixture must classify `ok` with a verbatim
   result.
4. **URL capture.** `urlBefore` / `urlAfter` populated on every tool call Event;
   differing across `go_checkout`.
5. **Verbatim expansion.** Expanded view contains the exact `sentArgs` JSON and the
   exact result string — assert on string equality, not substring.
6. **Chips from `getTools()`.** Chip count and labels match the fixture's registered
   tools, including across `frame.html` / `page2.html`.
7. **Destructive heuristic.** A `*-submit`-named fixture tool is flagged; a read-only
   one is not.
8. **Mode switch.** Assistant is default; Inspector renders upstream's table and
   Execute path unchanged; existing upstream assertions in `e2e.mjs` still pass.
9. **Contrast.** Computed `::placeholder` and disabled-text contrast ≥ 4.5:1 in both
   themes.
10. **Both themes render.** Forced light and dark, plus explicit toggle override.
11. **No console errors.** `e2e.mjs` already collects them; the run must stay clean.
12. **Merge-surface guard.** `git diff upstream/main --name-only` lists **only**
    `sidebar.js`, `sidebar.html`, `manifest.json`, and new files. `styles.css`,
    `content.js`, `background.js`, `utils.js` must show **zero** diff. This is the
    ADR-0001 invariant made executable, and it should fail the build if violated.

**Subjective — human judgement, not automatable:**

- Whether the Transcript reads calm at 400px.
- Palette, spacing, and Event block composition.
- Whether a `lost` Event communicates "it ran, the result vanished" without prose.

## Definition of Done

- All twelve machine-verifiable loops pass; `npm test` green with no console errors.
- Assistant mode is default; Inspector mode is byte-identical in behaviour to upstream.
- A tool call that navigates renders as `lost` with URL evidence — the specific bug
  class that motivated this work is visible without expanding anything.
- Every Event expands to verbatim `proposedArgs`, `sentArgs`, and result.
- Opener chips derive from `getTools()`; Destructive tools flagged.
- `git diff upstream/main --name-only` shows only the four declared files plus new
  files; `git merge upstream/main` applies cleanly from the current baseline.
- Extension loads unpacked in Chrome ≥ 150.0.7861.0 with the WebMCP flag on, named
  "AI Agent in Browser".
- Apache-2.0 notices intact in every file that carried them.
- `context.md` still describes what was built; any term that drifted is updated there,
  not just in code.
- No rejected concept from Non-goals has been implemented.
