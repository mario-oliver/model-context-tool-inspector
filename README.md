# WebMCP - Model Context Tool Inspector

A Chrome Extension that allows developers to inspect, monitor, and execute WebMCP
tools manually or with Gemini.

This is a **fork** of
[beaufortfrancois/model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)
(Apache-2.0). It adds a two-mode side panel: **Assistant mode** renders the agent
run as a Transcript of tool calls, and **Inspector mode** is the original UI,
unchanged. See `context.md` for the design language and `docs/adr/` for the
decisions.

## Prerequisites

1.  **Chrome 150.0.7861.0 or higher.** Check at `chrome://version`.
2.  **The WebMCP flag.** Go to `chrome://flags`, search for `WebMCP`, set
    **"WebMCP for testing"** to **Enabled**, and relaunch Chrome.

WebMCP is behind an Origin Trial, so without that flag `document.modelContext`
does not exist and the panel will report no tools on every page. This is the
single most common reason the extension looks broken.

Optional: a [Gemini API key](https://aistudio.google.com/apikey) if you want
Assistant mode to drive an agent. Listing tools, the opener chips and running a
tool by hand all work without one — but the Transcript only fills from the agent
loop, so it stays empty until a key is set.

## Install (load unpacked)

The Chrome Web Store
[listing](https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd)
is the **upstream** extension, not this fork. To run this fork, load it unpacked.

1.  **Clone the repository.**

    ```bash
    git clone https://github.com/mario-oliver/model-context-tool-inspector.git
    cd model-context-tool-inspector
    ```

2.  **Build the one bundled dependency.**

    ```bash
    npm install
    ```

    This is not optional. `sidebar.js` imports `./js-genai.js`, which is a
    generated bundle of the Gemini SDK and is **not** committed — without this
    step the side panel fails to load with a module resolution error.

    The `postinstall` script bundles the SDK and then deletes `node_modules`, so
    a successful run leaves `js-genai.js` behind and no dependency tree. That is
    intended, not a failed install.

3.  **Open** `chrome://extensions/`.

4.  **Enable Developer mode** — the toggle in the top right.

5.  **Click Load unpacked** and select the repository folder, the one containing
    `manifest.json`.

6.  **Pin the extension** from the toolbar's puzzle-piece menu, so the action
    icon is one click away.

After editing any file, return to `chrome://extensions/` and press the **reload**
arrow on the extension card. Changes to `sidebar.*`, `theme.*`, `transcript.js`,
`markdown.js` and `mode.js` appear when the side panel is reopened; changes to
`content.js` or `background.js` also need the target tab reloaded.

## First run

Public pages that register WebMCP tools are still scarce, so the repository
includes a demo site to point the extension at.

```bash
cd test/site && python3 -m http.server 8000
```

Open `http://localhost:8000/page1.html`, then click the extension's action icon
to open the **Side Panel**. You should see six tools listed.

| Page | What it exercises |
| --- | --- |
| `page1.html` | six tools, including `submit_order` (flagged destructive) and `go_checkout` (navigates mid-call, producing a **lost result**) |
| `page3.html` | tools whose `annotations` and names deliberately disagree — see `docs/adr/0004-forward-destructive-hint.md` |

If the panel says no tools are registered, the WebMCP flag is almost certainly
off — recheck step 2 of the prerequisites.

## Usage

The panel opens in **Assistant mode**. Switch modes with the tabs in the top
strip; the choice persists.

### Assistant mode

* **Chips** — one per registered tool. Clicking one fills the composer with a
  suggested prompt. It never executes anything.
* **User Prompt → Send** — runs the agent loop. Requires a Gemini API key, set
  via **Set Gemini API key**.
* **Transcript** — the run as it happens. One bordered row per tool call,
  carrying a status (`ok` / `error` / `lost`), the arguments, the duration and a
  destructive marker where it applies. Click a row to expand it to the raw
  schema, the proposed vs sent arguments, the verbatim result and the page URL
  either side of the call.
* **Reset** clears the Transcript. **Copy trace** copies the session for a bug
  report.
* **⚙ → Theme** switches between System, Light and Dark.

### Inspector mode

The original UI, unchanged, and the fastest way to run a single tool:

1.  **Tool** — pick one from the dropdown.
2.  **Input Arguments** — valid JSON, e.g. `{"text": "hello world"}`.
3.  Click **Execute Tool**.

The table above it lists every tool found on the page, including tools inside
iframes, with their frame IDs.

Note that a tool run this way reports into the result pane below, **not** into the
Transcript. The Transcript renders the agent loop; Inspector mode deliberately
bypasses it, which is what makes it useful for reproducing a call by hand after
copying the arguments out of a Transcript row.

## Tests

```bash
cd test && npm install && npm test
```

Playwright downloads Chrome for Testing into `test/.cache` on first run; set
`CHROME_PATH` to reuse an existing Chrome 150+ binary instead.

**The suite is flaky, and the flakiness is inherited from upstream** — it
reproduces on a pristine `upstream/main` checkout. Roughly one run in three dies
with an uncaught `TimeoutError` and prints no summary line. Treat only a printed
`N passed, M failed` line as a result; anything else means re-run.

## Disclaimer

This is not an officially supported Google product. This project is not
eligible for the [Google Open Source Software Vulnerability Rewards
Program](https://bughunters.google.com/open-source-security).
