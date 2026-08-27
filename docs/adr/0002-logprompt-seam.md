# ADR 0002: Build the Transcript on the `logPrompt` seam; do not modify the agent loop

## Status
Accepted — 2026-08-26

## Context

The target UI is a conversational Transcript with typed WebMCP tool-call blocks,
replacing upstream's `<pre id="promptResults">`, which receives flattened strings via
`logPrompt()`.

The first pass at this design added a confirmation gate ("pause before submitting"),
then step-mode, then edit-args-at-the-breakpoint, then dry-run interception of
destructive tools. Each was individually defensible. Together they rewrote
`promptAI()` — the 64-commit file — and made ADR-0001's tracking fork untenable.

Re-examining what the design actually required produced three findings:

**1. The agent loop is already correct and already emits the right events.**
`promptAI()` sends a message, reads `response.functionCalls`, executes each against
the page, pushes `functionResponse`, and repeats until the model returns text. Every
Transcript element maps onto a boundary it already crosses:

| Existing call | Transcript element |
|---|---|
| `promptResults.textContent += 'User prompt: "…"'` | user bubble |
| `logPrompt('AI calling tool "X" with …')` | tool-call block header |
| `logPrompt('Tool "X" result: …')` | result / status |
| `logPrompt('AI result: …')` | assistant prose |
| `logPrompt('⚠️ Error executing tool "X": …')` | error state |
| `logPrompt('⚠️ AI response has no text: …')` | warning state |

`logPrompt()` is not a logger to be worked around. It is the event bus, with the
types erased. Restoring the types is the whole job.

**2. The features that required loop surgery were replaceable.**
- Edit-args at a breakpoint duplicated Inspector mode, which already provides tool
  select + editable Input Arguments + Execute.
- Dry-run's protective value was replaceable by visually flagging destructive tools.
- The confirmation gate's diagnostic value was available post-hoc: every failure
  mode actually observed (stale results, results lost to navigation, a tool
  self-reporting `product: null` while the URL said `product=Opal`) is diagnosable
  from a recorded Event. The gate protected against side effects, not ignorance —
  a narrower benefit than it first appeared.

**3. The highest-value diagnostic needed no loop change either.**
Capturing the page URL before and after each tool call was initially scoped as a
`content.js` change. It is not: `sidebar.js` already holds `tab.id` and calls
`executeTool` itself, so it can read the URL either side of that call. No
content-script edit, no protocol change, no new permission.

## Decision

**All Event emission happens at the seam. `promptAI()`'s control flow is unchanged.**

- Change `logPrompt()` to emit typed Events instead of appending strings; leave every
  call site's position and meaning intact.
- Wrap the `executeTool` call in `sidebar.js` to capture URL before/after and
  duration.
- Render Events from a new `transcript.js`. Style from a new `theme.css`.
- Total edit surface in `sidebar.js`: **six** `logPrompt()` call sites (five inside
  `promptAI()`, one in the `promptBtn.onclick` catch reporting a thrown loop error),
  one direct user-prompt append, one Reset clear, and a wrapper on the **in-loop**
  `executeTool(tab.id, …)` call only. `executeTool`'s other call site — Inspector
  mode's Execute button — is left untouched.
- No gate, no step mode, no dry-run, no interception, no argument rewriting.

Destructive tools are flagged visually only (name heuristic; see `context.md`).

## Alternatives considered

- **Rewrite `promptAI()` around a structured event emitter.** The clean design.
  Rejected: it is the 64-commit file, and the seam gets ~95% of the benefit for ~5%
  of the merge cost.
- **Wrap or monkey-patch `promptAI()` from a new file without editing it.** Rejected:
  the loop is a module-scoped function with no injection point; a wrapper would have
  to duplicate its body, which is strictly worse than a small in-place diff.
- **Parse the existing `<pre>` text back into structured events.** Rejected as
  lossy and brittle — it would re-derive types from strings that were flattened
  precisely because types were discarded.
- **Keep the `<pre>` and only restyle it.** Rejected: it cannot express the `lost`
  status, the before/after URL pair, or expandable raw arguments — the three things
  the project exists to show.

## Consequences

**Easier:**
- Upstream changes to the loop merge cleanly, because the loop is untouched.
- The renderer is testable independently of Gemini: feed it Events.
- Adding a new Event kind is one emission site plus one render branch.

**Harder:**
- Destructive tools are live and unguarded. This is an **accepted risk**, recorded
  explicitly: `optimizely-submit-optimizely-lead-form-submit`,
  `optimizely-submit-demo-request-submit`, and
  `optimizely-submit-become-a-partner-inquiry-submit` submit real forms into real
  pipelines. Visual flagging is the only mitigation.
- If upstream ever refactors `logPrompt()` away, the seam moves and this ADR needs
  revisiting.

**Future agents must NOT:**
- Add a confirmation gate, step mode, or dry-run without superseding this ADR.
- Rewrite `promptAI()`.
- Move Event emission out of the seam into scattered call sites.
- Rebuild replay as a new feature — Inspector mode is the replay tool.
