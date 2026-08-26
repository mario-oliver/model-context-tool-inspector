# Context

This document defines the **ubiquitous language** for this project. The terms here
must be used consistently across product discussions, UI copy, code, agent
instructions, and documentation. The same word means the same thing everywhere.

## Product summary

A Chrome side-panel extension, named **AI Agent in Browser**, for debugging WebMCP
tools that a web page registers via `document.modelContext`. It is a **debugging
instrument that reads as a conversation**: an agent (Gemini) drives the page's
registered tools while the panel records exactly what was called, with what
arguments, and what came back. It is a fork of
[beaufortfrancois/model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)
(Apache-2.0) and is maintained as a **tracking fork** (see ADR-0001).

Primary user: Mario, debugging his own WebMCP tool registrations. Not a
consumer-facing assistant, and not a demo prop.

## Governing principle

**Calm by default, expandable to raw.**

The visual language is conversational, but no mechanism is discarded — only
collapsed. Every summary must be expandable to the verbatim arguments and the
verbatim result. A consumer-grade chat UI hides mechanism; this project's purpose
requires revealing it on demand. When the two conflict, revealing wins.

The concrete reason: the failure modes that matter here are **partial** — a tool
that reports success while returning stale content, or one whose result is
destroyed before it returns. A UI that can only render "succeeded" or "failed"
structurally cannot show these.

## Core concepts

### Assistant mode

Definition:
The default view. A **Transcript** of the agent conversation, plus a composer
("Ask about this page…") and **Opener chips**.

Rules:
- It is the default view on panel open.
- It renders Events; it does not own them.
- It must never be the only way to see a tool call's raw data.

Related concepts:
- Inspector mode, Transcript, Event

---

### Inspector mode

Definition:
The upstream UI, retained unchanged: the tool table, the tool `<select>`, the
Input Arguments textarea, Execute Tool, and the Copy-as-JSON /
Copy-as-ScriptToolConfig actions.

Rules:
- **Do not restyle or restructure this mode.** It is upstream's code and upstream's
  churn surface. Leave it alone so merges stay trivial.
- It is reached by an explicit mode switch, never automatically.
- It is the project's **replay tool**: to re-run a call with corrected arguments,
  copy the arguments out of a Transcript Event, paste into Input Arguments, edit,
  Execute. There is no separate replay feature and none should be built (see
  "Rejected concepts").

Related concepts:
- Assistant mode, Proposed args / Sent args

---

### Transcript

Definition:
The ordered, rendered stream of Events in Assistant mode. Replaces the upstream
`<pre id="promptResults">`.

Rules:
- Renders from the Event model only. It never reads agent state directly.
- Collapsed by default; every Event expandable to raw.
- Cleared by the existing Reset control.

Related concepts:
- Event, The seam

---

### Event

Definition:
One typed record of something that happened in the agent loop. The renderer's
entire input contract.

Rules:
- Event kinds map 1:1 onto the boundaries the upstream loop already emits:
  user message, assistant text, tool call, tool result, error, no-text warning.
- A **tool call** Event carries: tool name, `frameId` / origin, **Proposed args**,
  **Sent args**, verbatim result string, duration, **URL before** and **URL after**,
  and a status of `ok` / `error` / `lost`.
- Status is never a boolean and never a two-state enum. `lost` is not a kind of
  `error` (see Lost result).
- State is never encoded in hue alone. Every Event carries an icon and a short
  text label.

Implementation notes:
- Emitted from **The seam**, not from a rewritten loop.

Related concepts:
- Lost result, Proposed args / Sent args, The seam

---

### Lost result

Definition:
A tool call that **executed successfully but whose return value was destroyed**
before it could be read — in practice, because the tool's own action navigated or
reloaded the page. Surfaces as `Cannot return tool results after a cross-origin
navigation`.

Rules:
- `lost` is its own status, visually distinct from `error`.
- Rendering it as a failure is a **correctness bug**, not a style choice: the
  action did happen, and side effects may be real.
- The **URL before / URL after** pair on the Event is the evidence that
  distinguishes `lost` from `error`. Always show it on a `lost` Event.

Related concepts:
- Event

Implementation notes:
- Observed repeatedly against `optimizely-search-optimizely-resources` on
  optimizely.com: filters applied and the URL updated, but the result never
  returned. The follow-up read (calling the tool again with `{}`) is the workaround,
  not a fix.

---

### Proposed args / Sent args

Definition:
**Proposed args** are the arguments the model produced for a tool call. **Sent args**
are the arguments actually passed to the tool.

Rules:
- Both are recorded on every tool call Event, even when identical.
- They can differ only via Inspector-mode replay. Nothing in the agent loop
  rewrites arguments.

Related concepts:
- Inspector mode, Event

---

### The seam

Definition:
`logPrompt()` in `sidebar.js`, plus the direct `promptResults.textContent`
append for the user prompt and the Reset clear. Upstream already calls these at
exactly the semantic boundaries the Transcript needs.

Rules:
- **All Event emission happens here.** Changing `promptAI()`'s control flow is out
  of scope (see ADR-0002 and "Rejected concepts").
- Edit surface inside `sidebar.js`, and nothing else:
  - **six** `logPrompt()` call sites — five inside `promptAI()`, plus one in the
    `promptBtn.onclick` catch that reports a thrown loop error;
  - one direct user-prompt append (`promptResults.textContent += 'User prompt: …'`);
  - one Reset clear (`promptResults.textContent = ''`);
  - the **in-loop** `executeTool(tab.id, …)` call, wrapped for URL-before/after and
    duration.
- `executeTool` has a **second** call site, behind Inspector mode's Execute button.
  Leave that one alone — it is upstream's code and Inspector mode is untouched.

Related concepts:
- Event, Transcript

---

### Opener chip

Definition:
A conversation-starter button above the composer, one per tool registered on the
current page.

Rules:
- **Derived deterministically from `getTools()`** — never generated by the model.
- Doubles as a live readout of what the agent can reach on this page: a missing
  chip is a registration bug, visible before you type anything.
- Mid-conversation confirmation chips are **not** part of this concept and are not
  built (see "Rejected concepts").

Related concepts:
- Destructive tool

---

### Destructive tool

Definition:
A registered tool whose execution has outward-facing side effects — submitting a
form, sending a lead, making a purchase.

Rules:
- Identified by a **name heuristic**: `*-submit`, `submit-*`, `delete`, `purchase`.
- Flagged **visually only** — a marker on the Opener chip and on the Event. There
  is no interception, no gate, no confirmation.
- The heuristic is a stopgap. The correct signal is the WebMCP `annotations` field
  (`destructiveHint`), which pages currently leave unpopulated. When a page
  populates it, read that first and keep the heuristic as fallback.

Implementation notes:
- Live examples on optimizely.com, all wired to real pipelines:
  `optimizely-submit-optimizely-lead-form-submit`,
  `optimizely-submit-demo-request-submit`,
  `optimizely-submit-become-a-partner-inquiry-submit`.
- **Scope of the observation:** every tool observed on optimizely.com returned
  `annotations=undefined` — but this was measured **2026-08-24 against the older
  "08-20" snippet build**, identifiable by its old tool names
  (`discover-capabilities`, `submit-optimizely-lead-form`). The current "v8" build
  (~33 tools / 15 capabilities) reached the homepage by 2026-08-26 and **has not been
  checked**. Do not treat `annotations` as known-absent in v8; re-verify before
  relying on the heuristic being permanent.
- Populating `annotations` in Optimizely's own snippet is a **product action item**,
  tracked outside this repo (in `~/Code/web-mcp/`).

Related concepts:
- Opener chip, Event

---

### Tracking fork

Definition:
This repo follows upstream rather than diverging from it. `upstream` remote is
configured; changes are shaped to keep `git merge` trivial.

Rules:
- Prefer **new files** over edits to upstream files. New files never conflict.
- Never restructure or rewrite `styles.css`. Override it from `theme.css`, loaded
  after it.
- Never change `promptAI()`'s control flow.
- Never touch `content.js` or `background.js`.

Related concepts:
- The seam, Inspector mode

See ADR-0001.

### Direction B, "Panel" (the chosen visual language)

Definition:
The approved visual treatment, chosen by Mario on 2026-08-26 from three prototypes
(specimen: https://claude.ai/code/artifact/60b4b395-d747-42ec-83a8-b7d3ee863c4a).
Calm and roomy: rounded blocks, generous padding, status as pills and left stripes.

Rules:
- Applied **only** as a `theme.css` override loaded after `styles.css`. `styles.css` is
  never edited (ADR-0001).
- **No webfonts.** Native stacks only — an offline devtool must not depend on a network
  fetch, and MV3 extension-page CSP makes remote font loading fragile. Faces degrade to
  `system-ui`.
- Every value below is contrast-verified. Do not substitute colours without re-checking.
- Rejected alternatives, kept for the record: **A "Console"** (native devtool, monospace,
  hairline rules — denser and arguably better under load, but not chosen) and
  **C "Ledger"** (flat, ruled, uppercase labels, tabular numerals).

Implementation notes — the frozen token values:

| token | light | dark |
|---|---|---|
| `ground` | `#F6F5F3` | `#17161A` |
| `surface` | `#FFFFFF` | `#201F25` |
| `ink` | `#201F1D` | `#EAE8EC` |
| `muted` | `#67645F` | `#A19DA8` |
| `rule` | `#E4E1DC` | `#302E37` |
| `accent` | `#55507A` | `#A39CD0` |
| `onaccent` | `#FFFFFF` | `#15131C` |
| `thead` | `#F1EFEB` | `#262430` |
| `prebg` | `#F4F2EE` | `#1A1920` |
| `placeholder` | `#6E6B66` | `#9793A0` |
| `disabled` | `#6E6B66` | `#918D9C` |
| `ok` | `#1F5F44` | `#68C797` |
| `warn` | `#7E430F` | `#E5AB72` |
| `err` | `#992429` | `#F29691` |
| `status-bg` | `#F8F1E8` | `#241B14` |

- Geometry: radius `14px` (panel) / `9px` (controls); padding `1rem`; gap `0.85rem`.
- Faces: `"Avenir Next","Segoe UI Variable",system-ui,sans-serif` for text and chrome;
  `ui-monospace,"SF Mono",Menlo,Consolas,monospace` for data.
- Measured contrast (computed, not estimated): every text-on-ground pair clears WCAG AA
  4.5:1 in both themes. Tightest pairs are dark disabled `#918D9C` on `#262430` at
  **4.71:1** and light disabled `#6E6B66` on `#F1EFEB` at **4.62:1**. `#807C8B` was the
  original dark disabled value and was **rejected at 3.76:1**.
- Accent is violet, deliberately not green: in this tool green means *passed*, so a green
  accent would collide with the `ok` state.

Related concepts:
- Transcript, Event, Destructive tool, Tracking fork

---

## Rejected concepts

Recorded so they are not re-introduced by a future session. Each was considered and
deliberately dropped; re-adding any of them breaks the Tracking fork.

- **Confirmation gate / step mode** — pausing the loop before each tool call.
  Rejected: changes `promptAI()` control flow; the diagnostic value is available
  post-hoc from the Event record.
- **Edit-args at a breakpoint** — Inspector mode already does this. See Inspector mode.
- **Dry-run / simulated execution** — intercepting Destructive tools and returning
  synthetic success. Rejected as loop surgery. Replaced by visual flagging only.
  Accepted residual risk: Destructive tools are live and unguarded.
- **Model-emitted confirmation chips** — a second confirmation path that hides
  arguments. Rejected as duplicative and less informative.
- **Cards / schema-driven forms replacing the tool table** — would fork
  `sidebar.js`'s render path (64 upstream commits/12mo). Deferred, not dismissed;
  needs its own cycle.
- **Before/after URL capture in `content.js`** — unnecessary. `sidebar.js` already
  holds `tab.id` and calls `executeTool` itself, so it can read the URL either side
  of the call with no content-script change.

## Attribution

Apache-2.0. Upstream copyright headers (`Copyright 2026 Google LLC`,
`SPDX-License-Identifier: Apache-2.0`) must be **retained** in every file that
carries them, including files this fork modifies. Apache-2.0 §4 permits renaming the
derivative work but requires retaining notices and stating that files were changed.
Upstream's "not an officially supported Google product" disclaimer in `README.md`
should be kept and attributed to upstream.
