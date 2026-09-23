# Privacy Policy for AI Agent in Browser

**Last Updated:** September 23, 2026

This policy explains how the **AI Agent in Browser** Chrome extension ("the Extension") handles your data. Mario Oliver publishes the Extension as an individual developer.

The Extension is a developer tool that inspects, monitors, and runs WebMCP tools (`document.modelContext`). **It does not collect, track, store, or sell personal data.**

The Extension is a fork of [Model Context Tool Inspector](https://github.com/beaufortfrancois/model-context-tool-inspector) by François Beaufort, used under the Apache-2.0 license. It is not affiliated with or endorsed by Google.

---

## 1. Information the Extension does not collect

- **No personal information:** the Extension does not collect names, email addresses, physical addresses, phone numbers, or other identifying information.
- **No browsing history or analytics:** the Extension does not track, log, or send your browsing history, web activity, or usage analytics.
- **No telemetry or tracking:** the Extension contains no analytics libraries, advertising trackers, or fingerprinting code.
- **No developer server:** the Extension does not communicate with any server run by the developer.

---

## 2. Information handled locally

The Extension processes data inside your browser:

- **WebMCP tool metadata:** the content script reads the active page's `document.modelContext` API to get registered tool names, descriptions, input schemas, frame IDs, and tool annotations (for example `readOnlyHint`, `untrustedContentHint`, and `consequentialHint`). The side panel displays this information.
- **Tool execution data:** when you run a tool manually or through the AI assistant, the input parameters and results pass directly between the Extension and the web page or frame.
- **Local storage (`localStorage`):** the Extension stores these settings on your machine:
  - **Gemini API key:** if you provide a Google Gemini API key to enable AI features, the Extension stores it in `localStorage.apiKey`. The key goes only to Google's Gemini API endpoints.
  - **Selected model:** your chosen Gemini model, in `localStorage.model`.
  - **Prompt suggestion preference:** in `localStorage.suggestUserPrompt`.
  - **Display preferences:** your color theme in `localStorage.theme` and your Inspector or Assistant mode in `localStorage.mode`.
- **Clipboard:** the Extension writes to your clipboard (for example tool definitions or session debug traces) only when you click a "Copy" button. It never reads your clipboard.

---

## 3. Third-party services and network requests

By default, the Extension sends no data over the network.

### Google Gemini API

Only if you provide a Gemini API key and use the AI features (sending prompts or enabling prompt suggestions), the Extension connects from your browser directly to Google's Gemini API (`generativelanguage.googleapis.com`, through the official `@google/genai` library).

When you use these features:

- The Extension sends your prompt, the page's tool declarations (names, descriptions, schemas), and tool results to Google so the model can respond and call tools. Tool results can include content from the web page.
- [Google's Privacy Policy](https://policies.google.com/privacy) and the [Gemini API Additional Terms of Service](https://ai.google.dev/terms) govern that data.
- If you do not provide an API key, the Extension makes no requests to Google Gemini.

---

## 4. Permissions and why the Extension needs them

| Permission | Purpose |
| :-- | :-- |
| `sidePanel` | Shows the Extension's interface in Chrome's side panel. |
| `activeTab` | Gives temporary access to the active tab to inspect and run its tools. |
| `scripting` | Injects the content script into tabs that were already open when you installed the Extension, so it can reach `document.modelContext` without a reload. |
| `webNavigation` | Lists the frames in the active tab (`chrome.webNavigation.getAllFrames`) to find tools in embedded frames, and updates the tool count badge after navigation. |
| `host_permissions` (`<all_urls>`) | Lets the content script run on any page where you test WebMCP tools, including in embedded frames. |

---

## 5. Data retention and security

- All settings stay in your browser's local storage. To delete them, clear the API key in the Extension, clear site data for the Extension, or uninstall it.
- Connections to the Google Gemini API use HTTPS.

---

## 6. Children's privacy

The Extension does not knowingly collect personal information from children under 13.

---

## 7. Changes to this policy

When this policy changes, the "Last Updated" date at the top changes with it. The change history is in the repository below.

---

## 8. Source code and contact

The Extension is open source under the Apache-2.0 license. You can read the source to verify these practices:

- **Repository:** [mario-oliver/model-context-tool-inspector](https://github.com/mario-oliver/model-context-tool-inspector)
- **Questions:** open an issue in the repository.
