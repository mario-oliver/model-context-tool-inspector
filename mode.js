/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two-mode shell (issue 0004).
 *
 * Assistant mode is the default view (context.md#Assistant mode). Inspector mode
 * is upstream's UI, unchanged, reached only by an explicit switch — it is also the
 * project's replay tool: copy args out of a Transcript Event, paste into Input
 * Arguments, edit, Execute.
 *
 * Mode never changes without a user action. The choice persists in localStorage,
 * consistent with how sidebar.js already stores `model` and `apiKey`.
 */

const MODES = ['assistant', 'inspector'];
const STORAGE_KEY = 'mode';

const panels = {
  assistant: document.getElementById('mode-assistant'),
  inspector: document.getElementById('mode-inspector'),
};
const buttons = {
  assistant: document.getElementById('modeAssistant'),
  inspector: document.getElementById('modeInspector'),
};

/** Apply a mode. Unknown or absent values fall back to the default, assistant. */
export function setMode(mode, { persist = true } = {}) {
  const next = MODES.includes(mode) ? mode : 'assistant';
  for (const name of MODES) {
    panels[name]?.toggleAttribute('hidden', name !== next);
    // `.secondary` is upstream's outlined-button treatment; the active tab is the
    // solid one. Reusing it keeps this consistent with the existing buttons and
    // means theme.css styles both states without new selectors.
    buttons[name]?.classList.toggle('secondary', name !== next);
    buttons[name]?.setAttribute('aria-pressed', String(name === next));
  }
  document.documentElement.dataset.mode = next;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the mode still applies for this session.
    }
  }
  return next;
}

export function getMode() {
  return document.documentElement.dataset.mode ?? 'assistant';
}

let stored;
try {
  stored = localStorage.getItem(STORAGE_KEY);
} catch {
  stored = null;
}
setMode(stored ?? 'assistant', { persist: false });

for (const name of MODES) {
  buttons[name]?.addEventListener('click', () => setMode(name));
}
