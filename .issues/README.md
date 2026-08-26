# Issue index — Assistant mode Transcript

PRD: [`docs/prd/assistant-mode-transcript.md`](../docs/prd/assistant-mode-transcript.md)
Constraints: [ADR-0001](../docs/adr/0001-tracking-fork.md) · [ADR-0002](../docs/adr/0002-logprompt-seam.md)
Language: [`context.md`](../context.md)

## Umbrella branch

**`epic/assistant-transcript`**

Every issue branches off `epic/assistant-transcript` and merges back **into it**, never
into `main`. The cumulative review PR (`epic/assistant-transcript` → `main`) then exists
by construction, so `/review-diff` and `/code-review` get one clean diff.

```bash
git switch -c epic/assistant-transcript main   # once
git switch -c issue/0001-transcript-tracer epic/assistant-transcript
```

## Graph

```
                          ┌── 0002  lost result + URL capture        (AFK)
                          │
0001  Transcript tracer ──┼── 0003  expand to raw                    (AFK)
      (AFK)               │
                          └── 0004  two modes + shell ──┬── 0005  chips + destructive  (AFK)
                             (AFK)                      │
                                                        └── 0006  palette prototypes   (HUMAN)
                                                                        │
                                                                        └── 0007  apply theme
                                                                                  + fix defects (AFK)
```

| ID | Title | Type | Blocked by |
|---|---|---|---|
| 0001 | Render the agent run as a Transcript of typed Events | AFK | — |
| 0002 | Distinguish a lost result from an error, with URL evidence | AFK | 0001 |
| 0003 | Expand any Event to its verbatim arguments and result | AFK | 0001 |
| 0004 | Give the panel two modes and its own identity | AFK | 0001 |
| 0005 | Surface reachable tools as chips, and mark the destructive ones | AFK | 0004 |
| 0006 | Choose the visual language from three throwaway prototypes | **Human** | 0004 |
| 0007 | Apply the chosen theme and fix the inherited CSS defects | AFK | 0006 |

**Parallelism:** after 0001, three tracks open ({0002, 0003, 0004}). After 0004, two more
({0005, 0006}). Longest path is 0001 → 0004 → 0006 → 0007 = 4 of 7 issues (57%), just
under the 60% consolidation threshold — the graph has genuine parallel width, so the
slices stay separate.

**The one blocking human step** is 0006. It gates only 0007; everything else can complete
around it.

## Tooling gap, stated plainly

This repo has **no typecheck and no lint** — vanilla JS, no build step. The only
automated gates are:

```bash
cd test && npm test          # Playwright e2e; loads the unpacked extension into real Chrome
npm run guard:merge-surface  # created in 0001; asserts the ADR-0001 invariant
```

Every issue's Feedback Loops are therefore thinner than usual. Introducing a toolchain
was deliberately left out of scope — it is a separate decision, not a side effect of this
epic. If the thin gates prove insufficient, that is an ADR, not an ad-hoc addition.

## Next step

`/analyze` this issue set against the PRD before any implementation. Resolve every
Blocker it reports. Then AFK issues go to `/inner-loop` one at a time; 0006 goes to Mario.
