/**
 * theme.js — manual theme toggle for the Direction B ("Panel") override
 * layer in theme.css. See docs/adr/0001-tracking-fork.md: this is a new
 * file, not an edit to styles.css or sidebar.js.
 *
 * Model: localStorage.theme is 'light', 'dark', or absent ('system').
 * Absent means "no explicit choice" — theme.css's prefers-color-scheme
 * block decides, and this script leaves [data-theme] off <html> so that
 * block isn't guarded away. An explicit choice sets [data-theme] on
 * <html>, which theme.css's :root[data-theme="…"] blocks pick up and
 * which wins over the OS setting in both directions.
 *
 * Loaded as a plain (non-module, non-deferred) <script> in <head>, after
 * theme.css, so the attribute is applied before <body> paints — no
 * flash of the wrong theme.
 */

(function applyStoredTheme() {
  let stored;
  try {
    stored = localStorage.getItem('theme');
  } catch {
    stored = null;
  }
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
})();

// The toggle control itself lives in the ⚙ menu (dialog#advancedSection),
// whose body markup belongs to another in-flight issue. Inject it at
// runtime instead of hand-editing sidebar.html, so this never conflicts
// with that work — we only depend on the dialog's id, which sidebar.js
// already depends on too.
function injectThemeToggle() {
  const dialog = document.getElementById('advancedSection');
  if (!dialog || document.getElementById('themeMenuLabel')) return;

  const current = (() => {
    try {
      return localStorage.getItem('theme');
    } catch {
      return null;
    }
  })();

  const menuLabel = document.createElement('div');
  menuLabel.id = 'themeMenuLabel';
  menuLabel.className = 'menu-label';
  menuLabel.textContent = 'Theme';
  dialog.appendChild(menuLabel);

  const options = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];

  for (const [value, text] of options) {
    const label = document.createElement('label');
    label.className = 'model-option';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'theme';
    input.value = value;
    input.checked = value === (current === 'light' || current === 'dark' ? current : 'system');

    input.addEventListener('change', () => {
      if (!input.checked) return;
      try {
        if (value === 'system') {
          localStorage.removeItem('theme');
        } else {
          localStorage.setItem('theme', value);
        }
      } catch {
        // localStorage unavailable; the choice still applies for this
        // page load via the attribute set below.
      }
      if (value === 'light' || value === 'dark') {
        document.documentElement.setAttribute('data-theme', value);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    });

    const span = document.createElement('span');
    span.textContent = text;

    label.appendChild(input);
    label.appendChild(span);
    dialog.appendChild(label);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectThemeToggle);
} else {
  injectThemeToggle();
}
