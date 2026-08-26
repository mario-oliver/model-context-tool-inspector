# ADR 0001: Maintain this as a tracking fork, not a hard fork

## Status
Accepted — 2026-08-26

## Context

This repo is a fork of
[beaufortfrancois/model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)
(Apache-2.0), cloned to restyle its UI and eventually reshape it into a debugging
instrument for WebMCP tool registrations.

Two facts forced the decision:

**Upstream is alive and chasing a moving spec.** v1.9.14, last pushed 2026-08-19.
WebMCP is still in Origin Trial; `getTools()` / `executeTool()` are newer than
`registerTool()` and not yet in Chrome stable. `content.js` carries a live
`TODO: Remove this when executeTool doesn't accept JSON stringified inputArgs
anymore in Chrome Stable`. Upstream is absorbing breakage we would otherwise debug
ourselves.

**Upstream churn is concentrated in exactly the files a redesign would touch.**
Commits per file, trailing 12 months:

| File | Commits |
|---|---|
| `sidebar.js` | 64 |
| `content.js` | 34 |
| `background.js` | 19 |
| `styles.css` | 18 |
| `sidebar.html` | 17 |

Worse, the `styles.css` log shows upstream iterating on our exact targets:
"Refactor font sizes to use rem units", "Add dark color scheme", "Change user prompt
text font", "Improve UX nits". A rewrite would collide roughly monthly.

At the time of this decision the fork was 0 commits behind — a clean baseline.

## Decision

Maintain a **tracking fork**. Keep merging upstream, and shape all work to keep
`git merge` trivial:

- `upstream` remote is configured.
- Prefer **new files** over edits to upstream files. New files never conflict.
- `styles.css` is **never rewritten or restructured**. It is overridden from a new
  `theme.css`, loaded after it.
- `promptAI()`'s control flow is **never changed**.
- `content.js` and `background.js` are **not touched**.
- Edits to `sidebar.js` are confined to the seam (see ADR-0002).

## Alternatives considered

- **Hard fork** — own the code, rip `styles.css` down to design tokens, delete the
  125-line duplicated dark-mode block, fix the font stack and contrast properly.
  Rejected: every upstream fix becomes a manual port, against a spec still changing
  under us. The clean-CSS win is real but small (429 lines); the ongoing cost is not.
- **Vendor upstream as a submodule and build a separate UI on top** — rejected as
  disproportionate for ~1,300 lines of vanilla JS with no build step.
- **No fork; contribute upstream instead** — rejected because the intended direction
  (a debugging instrument with a two-mode UI) is not upstream's product.

## Consequences

**Easier:**
- Upstream bug fixes and spec-tracking fixes arrive with `git merge`.
- Two stylesheets and a handful of new files carry the entire redesign.

**Harder:**
- Two stylesheets instead of one, and override specificity has to fight upstream's
  `!important` in `.secondary` and the disabled-state rules.
- Known upstream defects cannot simply be fixed in place — the Segoe-UI-first font
  stack (falls through to Verdana on macOS), the missing `color-scheme` declaration,
  and sub-AA contrast on `::placeholder` (#a3a3a3 on white ≈ 2.3:1) and disabled
  text (#9ca3af on #f3f4f6). These must be corrected by override, or upstreamed as
  PRs.

**Future agents must NOT:**
- Rewrite or reformat `styles.css`.
- Restyle or restructure Inspector mode.
- Change `promptAI()`'s control flow.
- Edit `content.js` or `background.js`.
  **Amended by [ADR-0003](0003-content-js-exception.md)**: one narrowly-bounded
  idempotency fix in `content.js` is permitted. `background.js` remains untouchable.
- Delete upstream Apache-2.0 copyright headers.

This decision is revisitable. Converting to a hard fork once WebMCP reaches Chrome
stable is cheap. The reverse — restoring mergeability after a rewrite — is not.
That asymmetry is the whole reason for the decision.
