/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// End-to-end test: loads the unpacked extension in a WebMCP-enabled Chrome
// and drives the sidebar UI against a local demo site.
//
// Usage: npm install && npm test
// (run npm install in the repo root first so js-genai.js exists)
//
// Chrome for Testing stable is downloaded to .cache on first run; set
// CHROME_PATH to use an existing binary instead (needs Chrome 150+).

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const PROFILE = path.join(__dirname, '.profile');

if (!fs.existsSync(path.join(EXT, 'js-genai.js'))) {
  console.error('js-genai.js is missing; run npm install in the repo root first.');
  process.exit(1);
}

async function getChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const browsers = await import('@puppeteer/browsers');
  const cacheDir = path.join(__dirname, '.cache');
  let buildId;
  try {
    buildId = await browsers.resolveBuildId('chrome', browsers.detectBrowserPlatform(), 'stable');
  } catch {
    // Offline; fall back to the newest build already in the cache.
    const cached = new browsers.Cache(cacheDir)
      .getInstalledBrowsers()
      .filter((b) => b.browser === 'chrome')
      .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));
    if (!cached.length) {
      throw new Error('cannot resolve a chrome build and none is cached; set CHROME_PATH');
    }
    buildId = cached.at(-1).buildId;
  }
  let loggedMB = 0;
  await browsers.install({
    browser: 'chrome',
    buildId,
    cacheDir,
    downloadProgressCallback(downloaded, total) {
      if (downloaded - loggedMB >= 26214400 || downloaded === total) {
        loggedMB = downloaded;
        console.log(`downloading chrome ${buildId}: ${Math.round(downloaded / 1048576)}/${Math.round(total / 1048576)}MB`);
      }
    },
  });
  return browsers.computeExecutablePath({ browser: 'chrome', buildId, cacheDir });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/favicon')) {
    res.writeHead(204);
    res.end();
    return;
  }
  const file = path.join(__dirname, 'site', (req.url === '/' ? 'page1.html' : req.url).split('?')[0]);
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

fs.rmSync(PROFILE, { recursive: true, force: true });

const failures = [];
const passes = [];
function check(name, cond, detail = '') {
  (cond ? passes : failures).push(name);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
}

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: await getChrome(),
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--enable-features=WebMCP,WebMCPTesting',
    // Chrome for Testing ships no setuid helper, and distros that restrict
    // unprivileged user namespaces (e.g. Ubuntu 23.10+) abort on launch
    // without this.
    '--no-sandbox',
  ],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const extensionId = new URL(sw.url()).host;

const consoleErrors = [];
function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
}
context.on('page', (p) => watch(p, 'spawned'));

const demo = context.pages()[0];
watch(demo, 'demo');
await demo.goto(`${BASE}/page1.html`);
await demo.waitForLoadState('load');

// Run sidebar.html as a tab, shimming only chrome.tabs.query so the page
// resolves the demo tab as "active" (a real side panel resolves the browser
// tab it is attached to; sidePanel.open() needs a user gesture we cannot
// produce here). Everything else, messaging included, is real.
const demoTabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${BASE}/page1.html`);
const sidebar = await context.newPage();
await sidebar.addInitScript(`
  if (location.protocol === 'chrome-extension:') {
    const realQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q, cb) => {
      if (q && q.active && q.currentWindow) {
        const p = chrome.tabs.get(${demoTabId}).then((t) => [t]);
        if (cb) { p.then(cb); return; }
        return p;
      }
      return realQuery(q, cb);
    };
  }
`);
watch(sidebar, 'sidebar');
await sidebar.goto(`chrome-extension://${extensionId}/sidebar.html`);
await sidebar.waitForLoadState('load');

// Backgrounded tabs don't run requestAnimationFrame; poll on an interval.
const waitSidebar = (fn, timeout = 10000) => sidebar.waitForFunction(fn, null, { timeout, polling: 120 });
const toolResults = () => sidebar.$eval('#toolResults', (el) => el.textContent);

async function runTool(name, args) {
  await sidebar.selectOption('#toolNames', { value: name });
  await sidebar.fill('#inputArgsText', JSON.stringify(args));
  await sidebar.click('#executeBtn');
}

async function backToPage1() {
  // The tab sits on page2 after a navigation test. Wait for its empty-tools
  // broadcast to land first, so the tool list wait below cannot be satisfied
  // by the stale page1 render.
  await waitSidebar(() => document.body.textContent.includes('No tools registered yet'));
  await demo.bringToFront();
  await demo.goto(`${BASE}/page1.html`);
  await waitSidebar(() => document.querySelectorAll('#toolNames option').length >= 6);
}

// All six tools listed (5 top-level + 1 in the iframe)
await waitSidebar(() => document.querySelectorAll('#toolNames option').length >= 6);
const optionText = await sidebar.$$eval('#toolNames option', (els) => els.map((e) => e.textContent));
for (const name of ['add_numbers', 'go_checkout', 'submit_order', 'open_report', 'frame_order']) {
  check(`lists ${name}`, optionText.some((t) => t.includes(name)));
}
check('lists iframe tool with frameId', optionText.some((t) => t.includes('echo_frame') && /\(\d+\)/.test(t)), optionText.find((t) => t.includes('echo_frame')) || 'missing');

// Badge shows the tool count on the demo tab. Extended to also prove that
// re-injecting content.js into this same, already-open tab (the path
// background.js's onInstalled catch-up uses to reach tabs the side panel
// never navigated) still produces a fresh listing and not a silent no-op:
// clear the badge, force a same-frame re-injection with no other message in
// between, and confirm the badge can only have come back from that.
async function waitForBadge(tabId, expected, timeout = 8000) {
  const start = Date.now();
  let text;
  while (Date.now() - start < timeout) {
    text = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    if (text === expected) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return text;
}
let badge = await waitForBadge(demoTabId, '6');
await sw.evaluate((id) => chrome.action.setBadgeText({ text: '', tabId: id }), demoTabId);
await sw.evaluate(
  (tabId) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }),
  demoTabId,
);
badge = await waitForBadge(demoTabId, '6');
check('badge shows tool count, including after re-injection into an already-open tab', badge === '6', `badge="${badge}"`);

// Script tool, fast path
await demo.bringToFront();
await runTool('add_numbers', { a: 2, b: 3 });
await waitSidebar(() => document.getElementById('toolResults').textContent !== '');
check('script tool fast path', (await toolResults()) === 'sum is 5', `result="${await toolResults()}"`);

// Iframe script tool (exercises the frameId relay)
await runTool('echo_frame', {});
await waitSidebar(() => /iframe|Error/.test(document.getElementById('toolResults').textContent), 15000);
check('iframe tool result', (await toolResults()) === 'hello from the iframe', `result="${await toolResults()}"`);

// Declarative form tool targeting an inline frame (content.js reads the
// ld+json out of the frame itself)
await runTool('frame_order', { qty: 2 });
await waitSidebar(() => /ORDER|Error/.test(document.getElementById('toolResults').textContent), 15000);
check('form tool with iframe target', (await toolResults()).includes('ORDER-12345'), `result="${await toolResults()}"`);

// Script tool that navigates the tab (message channel closes mid-flight)
await runTool('go_checkout', {});
await waitSidebar(() => /ORDER|Error/.test(document.getElementById('toolResults').textContent), 20000);
check('cross-document result, script navigation', (await toolResults()).includes('ORDER-12345'), `result="${await toolResults()}"`);
await backToPage1();

// Declarative form tool, same-tab navigation (native null result)
await runTool('submit_order', { qty: 3 });
await waitSidebar(() => /ORDER|Error/.test(document.getElementById('toolResults').textContent), 20000);
check('cross-document result, form navigation', (await toolResults()).includes('ORDER-12345'), `result="${await toolResults()}"`);
await backToPage1();

// Declarative form tool with target=_blank (result lands in a new tab)
const newTabPromise = context.waitForEvent('page', { timeout: 15000 });
await runTool('open_report', { kind: 'full' });
const newTab = await newTabPromise;
await waitSidebar(() => /ORDER|Error/.test(document.getElementById('toolResults').textContent), 20000);
check('cross-document result from new tab', (await toolResults()).includes('ORDER-12345'), `result="${await toolResults()}"`);
await newTab.close();

// Page without tools shows the empty state
await demo.bringToFront();
await demo.goto(`${BASE}/page2.html`);
await waitSidebar(() => document.body.textContent.includes('No tools registered yet'));
check('no-tools page shows empty state', true);

// --- Theme (issue 0007): token-driven light/dark, the explicit toggle,
// and the two inherited contrast/font defects. These read computed
// styles only, never text content, so they're independent of whatever
// markup other issues add.

function parseRGB(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s));
  return { r, g, b };
}

function relLuminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const themeStyles = () =>
  sidebar.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const promptBtn = document.getElementById('promptBtn');
    const userPromptText = document.getElementById('userPromptText');
    // Chromium only generates the ::placeholder box (and so returns its
    // own computed style, rather than silently falling back to the
    // element's regular text color) when the element actually carries a
    // placeholder attribute. The markup has none today, so set one here,
    // for measurement only — this mutates the live DOM in this test run,
    // not any production file.
    const hadPlaceholder = userPromptText.hasAttribute('placeholder');
    const priorPlaceholder = userPromptText.getAttribute('placeholder');
    userPromptText.setAttribute('placeholder', 'measure');
    const placeholderColor = getComputedStyle(userPromptText, '::placeholder').color;
    if (hadPlaceholder) userPromptText.setAttribute('placeholder', priorPlaceholder);
    else userPromptText.removeAttribute('placeholder');
    return {
      fontFamily: getComputedStyle(body).fontFamily,
      colorScheme: getComputedStyle(html).colorScheme,
      // Placeholder text renders inside the control, against its own
      // background (var(--surface)) — not the page background.
      controlBg: getComputedStyle(userPromptText).backgroundColor,
      placeholderColor,
      disabledColor: getComputedStyle(promptBtn).color,
      disabledBg: getComputedStyle(promptBtn).backgroundColor,
    };
  });

async function reloadSidebar() {
  await sidebar.reload();
  await sidebar.waitForLoadState('load');
}

function checkContrast(label, fgStr, bgStr) {
  const fg = parseRGB(fgStr);
  const bg = parseRGB(bgStr);
  const ratio = fg && bg ? contrastRatio(fg, bg) : NaN;
  check(`${label} contrast >= 4.5:1`, ratio >= 4.5, `${ratio.toFixed(2)}:1 (fg=${fgStr}, bg=${bgStr})`);
}

// Defect fix: font stack no longer Segoe-UI-first (which falls through to
// Verdana on macOS).
{
  const { fontFamily } = await themeStyles();
  check(
    'body font-family leads with a system UI face, not Segoe UI',
    !/^\s*"?segoe/i.test(fontFamily),
    fontFamily,
  );
}

// No explicit choice stored: follows prefers-color-scheme, both directions.
await sidebar.evaluate(() => localStorage.removeItem('theme'));
await sidebar.emulateMedia({ colorScheme: 'light' });
await reloadSidebar();
{
  const s = await themeStyles();
  check('no stored choice + system light -> color-scheme light', s.colorScheme === 'light', s.colorScheme);
  checkContrast('light placeholder', s.placeholderColor, s.controlBg);
  checkContrast('light disabled-text', s.disabledColor, s.disabledBg);
}

await sidebar.emulateMedia({ colorScheme: 'dark' });
await reloadSidebar();
{
  const s = await themeStyles();
  check('no stored choice + system dark -> color-scheme dark', s.colorScheme === 'dark', s.colorScheme);
  checkContrast('dark placeholder', s.placeholderColor, s.controlBg);
  checkContrast('dark disabled-text', s.disabledColor, s.disabledBg);
}

// Explicit choice wins over the OS setting, in both directions.
await sidebar.evaluate(() => localStorage.setItem('theme', 'light'));
await reloadSidebar(); // system still dark, from above
{
  const s = await themeStyles();
  check('explicit light wins while system is dark', s.colorScheme === 'light', s.colorScheme);
}

await sidebar.emulateMedia({ colorScheme: 'light' });
await sidebar.evaluate(() => localStorage.setItem('theme', 'dark'));
await reloadSidebar();
{
  const s = await themeStyles();
  check('explicit dark wins while system is light', s.colorScheme === 'dark', s.colorScheme);
}

// Manual toggle in the gear menu: applies live, and the choice persists
// across a reload ("survives panel reopen").
await sidebar.evaluate(() => localStorage.removeItem('theme'));
await sidebar.emulateMedia({ colorScheme: 'light' });
await reloadSidebar();
await sidebar.click('#advancedBtn');
await sidebar.click('input[name="theme"][value="dark"]');
{
  const s = await themeStyles();
  check('toggle applies dark immediately, no reload needed', s.colorScheme === 'dark', s.colorScheme);
}
await reloadSidebar();
{
  const s = await themeStyles();
  check('toggle choice survives panel reopen', s.colorScheme === 'dark', s.colorScheme);
  const stored = await sidebar.evaluate(() => localStorage.getItem('theme'));
  check('toggle persists via localStorage.theme', stored === 'dark', stored);
}

// No horizontal body scroll at a narrow (400px) sidebar width, either theme.
await sidebar.setViewportSize({ width: 400, height: 600 });
for (const theme of ['light', 'dark']) {
  await sidebar.evaluate((t) => localStorage.setItem('theme', t), theme);
  await reloadSidebar();
  const overflow = await sidebar.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`no horizontal body scroll at 400px (${theme})`, overflow <= 0, `overflow=${overflow}px`);
}
await sidebar.evaluate(() => localStorage.removeItem('theme'));

// No console errors or unhandled rejections anywhere
const relevantErrors = consoleErrors.filter((e) => !e.includes('net::'));
check('no console errors', relevantErrors.length === 0, relevantErrors.join(' | ') || 'clean');

await context.close();
server.close();

console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
