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
