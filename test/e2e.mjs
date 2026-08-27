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
  watched.add(page);
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] console.error: ${msg.text()}`);
  });
  // Keep the stack, not just the message: a bare "reading 'length'" with no
  // frames is unactionable, and this gate is cumulative, so the throw can have
  // happened many checks before the failure is reported.
  page.on('pageerror', (err) =>
    consoleErrors.push(`[${label}] pageerror: ${err.stack ?? err.message}`),
  );
}
// The sidebar page is created by context.newPage() below, so this handler fires
// for it too and it ends up watched twice — once as 'spawned', once as
// 'sidebar'. That reported a single throw as two errors, which reads like two
// independent failures in two contexts. Watch each page once.
const watched = new WeakSet();
context.on('page', (p) => {
  if (!watched.has(p)) watch(p, 'spawned');
});

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

// Issue 0004: Inspector mode is hidden by default now, and Playwright's
// click/fill/selectOption all enforce visibility — so switch modes first.
async function ensureInspector() {
  await sidebar.click('#modeInspector');
  await waitSidebar(() => !document.getElementById('mode-inspector').hasAttribute('hidden'));
}

async function ensureAssistant() {
  await sidebar.click('#modeAssistant');
  await waitSidebar(() => !document.getElementById('mode-assistant').hasAttribute('hidden'));
}

async function runTool(name, args) {
  await ensureInspector();
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

// Issue 0001: transcript.js renders a hand-written fixture covering all five
// Event kinds with no API key set and no network access. Run this first,
// before apiKeyBtn is ever clicked and before any request to Gemini could
// possibly have been made, so "no network access" is provable rather than
// asserted.
async function getTranscriptEvents() {
  return sidebar.evaluate(async () => (await import('./transcript.js')).getEvents());
}

const transcriptFixtureRequests = [];
const trackTranscriptFixtureRequests = (req) => transcriptFixtureRequests.push(req.url());
sidebar.on('request', trackTranscriptFixtureRequests);

const fixture = await sidebar.evaluate(async () => {
  const T = await import('./transcript.js');
  T.reset();
  T.append('user', { text: 'What is 2 + 3?' });
  const ok = T.append('toolCall', {
    toolName: 'add_numbers',
    frameId: 0,
    proposedArgs: { a: 2, b: 3 },
    sentArgs: { a: 2, b: 3 },
  });
  T.update(ok, { status: 'ok', result: 'sum is 5' });
  const err = T.append('toolCall', {
    toolName: 'optimizely-submit-demo-request-submit',
    frameId: 0,
    proposedArgs: {},
    sentArgs: {},
  });
  T.update(err, { status: 'error', errorMessage: 'boom' });
  T.append('assistant', { text: 'The sum is 5.' });
  T.append('warning', { text: 'AI response has no text: []' });
  T.append('error', { text: 'Error: network down' });

  const root = document.getElementById('transcript');
  const evs = [...root.querySelectorAll('details.t-ev')];
  return {
    precisVisible: (() => { const el = document.querySelector('#transcript details.t-ev .precis'); return el ? el.checkVisibility({ contentVisibilityAuto: true }) : null; })(),
    hasFlow: !!root.querySelector('.t-flow'),
    userCount: root.querySelectorAll('.t-user').length,
    userText: root.querySelector('.t-user')?.textContent || '',
    assistCount: root.querySelectorAll('.t-assist').length,
    assistText: root.querySelector('.t-assist')?.textContent || '',
    errCount: root.querySelectorAll('.t-error').length,
    warnCount: root.querySelectorAll('.t-warning').length,
    evCount: evs.length,
    evClasses: evs.map((e) => e.className),
    evStructure: evs.map((e) => ({
      who: e.querySelector('summary .who')?.textContent,
      tool: e.querySelector('summary .tool')?.textContent,
      hasMs: !!e.querySelector('summary .ms'),
      hasChev: !!e.querySelector('summary .chev'),
      precis: e.querySelector(':scope > summary > .precis')?.textContent,
      // .t-evidence moved inside <summary> so it reads while collapsed; it is no
      // longer a direct child of <details>.
      hasEvidence: !!e.querySelector('.t-evidence'),
      hasRawKv: !!e.querySelector(':scope > .t-raw > dl.t-kv'),
    })),
  };
});

sidebar.off('request', trackTranscriptFixtureRequests);
// Leave the store clean for the tool-listing / Inspector-mode checks below.
await sidebar.evaluate(async () => (await import('./transcript.js')).reset());

check('transcript fixture: renders with no network requests', transcriptFixtureRequests.length === 0, transcriptFixtureRequests.join(', '));
check('transcript fixture: #transcript > .t-flow present', fixture.hasFlow);
check('transcript fixture: exactly one .t-user', fixture.userCount === 1 && fixture.userText.includes('What is 2 + 3?'), fixture.userText);
check('transcript fixture: exactly one .t-assist', fixture.assistCount === 1 && fixture.assistText.includes('The sum is 5.'), fixture.assistText);
check('transcript fixture: one .t-error and one .t-warning', fixture.errCount === 1 && fixture.warnCount === 1, `err=${fixture.errCount} warn=${fixture.warnCount}`);
check('transcript fixture: one details.t-ev per tool call (2)', fixture.evCount === 2, JSON.stringify(fixture.evClasses));
check('transcript fixture: status carried as a class, ok then err', (fixture.evClasses[0] || '').includes('ok') && (fixture.evClasses[1] || '').includes('err'), JSON.stringify(fixture.evClasses));
check(
  'transcript fixture: summary has who/tool/ms/chev, icon agrees with ok class',
  fixture.evStructure[0]?.who === 'MCP' &&
    fixture.evStructure[0]?.tool.includes('✓') &&
    fixture.evStructure[0]?.tool.includes('add_numbers') &&
    fixture.evStructure[0]?.hasMs &&
    fixture.evStructure[0]?.hasChev,
  JSON.stringify(fixture.evStructure[0]),
);
check('transcript fixture: icon agrees with err class', fixture.evStructure[1]?.tool.includes('✗'), JSON.stringify(fixture.evStructure[1]));
check('transcript fixture: .precis is genuinely VISIBLE while collapsed', fixture.precisVisible === true, `visible=${fixture.precisVisible}`);
check(
  'transcript fixture: .t-evidence and .t-raw > dl.t-kv reserved but empty',
  fixture.evStructure.every((s) => s.hasEvidence && s.hasRawKv),
  JSON.stringify(fixture.evStructure),
);

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

// Issue 0001: a real agent run, through promptAI()'s real unchanged control
// flow, produces typed Events. The Gemini HTTP endpoint is intercepted so
// the run is deterministic and needs no real API key or network egress; the
// tool call itself (add_numbers) executes for real against page1.html.
let scriptedGeminiResponses = [];
await sidebar.route(/generativelanguage\.googleapis\.com/, async (route) => {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204 });
    return;
  }
  const next = scriptedGeminiResponses.shift();
  if (!next) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }),
    });
    return;
  }
  if (next.fail) {
    // A non-2xx status here would make Chrome itself log a "Failed to load
    // resource" console.error for what is, from the browser's point of
    // view, a real failed fetch — even though it's our own mocked response.
    // That would trip the "no console errors" gate for a failure we asked
    // for. Stay 200 and break the SDK's own JSON parsing instead: still an
    // uncaught rejection out of chat.sendMessage(), caught by promptAI()'s
    // caller exactly like a real thrown loop error would be.
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'not valid json' });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next.body) });
});

sidebar.once('dialog', (dialog) => dialog.accept('test-key'));
await ensureAssistant();
await sidebar.click('#apiKeyBtn');
await waitSidebar(() => !document.getElementById('promptBtn').disabled);

scriptedGeminiResponses = [
  {
    body: {
      candidates: [{ content: { parts: [{ functionCall: { name: '_0_add_numbers', args: { a: 4, b: 5 } } }] } }],
    },
  },
  { body: { candidates: [{ content: { parts: [{ text: 'The sum is 9.' }] } }] } },
];
await ensureAssistant();
await sidebar.fill('#userPromptText', 'What is 4 plus 5?');
await sidebar.click('#promptBtn');
await waitSidebar(() => document.querySelectorAll('#transcript .t-assist').length >= 1, 20000);

let transcriptEvents = await getTranscriptEvents();
let userEvents = transcriptEvents.filter((e) => e.kind === 'user');
let assistantEvents = transcriptEvents.filter((e) => e.kind === 'assistant');
let toolCallEvents = transcriptEvents.filter((e) => e.kind === 'toolCall');
check(
  'agent run: exactly one user Event',
  userEvents.length === 1 && userEvents[0].text === 'What is 4 plus 5?',
  JSON.stringify(userEvents),
);
check(
  'agent run: exactly one assistant Event',
  assistantEvents.length === 1 && assistantEvents[0].text === 'The sum is 9.',
  JSON.stringify(assistantEvents),
);
check(
  'agent run: toolCall Event for add_numbers is ok with the verbatim result',
  toolCallEvents.length === 1 &&
    toolCallEvents[0].toolName === 'add_numbers' &&
    toolCallEvents[0].status === 'ok' &&
    toolCallEvents[0].result === 'sum is 9',
  JSON.stringify(toolCallEvents),
);

const toolDom = await sidebar.evaluate(() => {
  const el = document.querySelector('#transcript details.t-ev');
  return (
    el && {
      className: el.className,
      tool: el.querySelector('summary .tool')?.textContent,
      who: el.querySelector('summary .who')?.textContent,
    }
  );
});
check(
  'agent run: rendered details.t-ev.ok carries the resolved status and icon',
  toolDom?.className.includes('t-ev') &&
    toolDom.className.includes('ok') &&
    toolDom.who === 'MCP' &&
    toolDom.tool.includes('✓') &&
    toolDom.tool.includes('add_numbers'),
  JSON.stringify(toolDom),
);

// Reset clears both the Event store and the rendered Transcript.
await ensureAssistant();
await sidebar.click('#resetBtn');
const eventsAfterReset = await getTranscriptEvents();
const domAfterReset = await sidebar.$eval(
  '#transcript',
  (el) => el.querySelectorAll('.t-user, .t-assist, .t-ev, .t-error, .t-warning').length,
);
check('Reset clears all Events', eventsAfterReset.length === 0, JSON.stringify(eventsAfterReset));
check('Reset clears the rendered Transcript', domAfterReset === 0, `remaining=${domAfterReset}`);

// A thrown loop error — the promptBtn.onclick catch site, the sixth
// logPrompt() call site — produces exactly one error Event and nothing else.
scriptedGeminiResponses = [{ fail: true }];
await ensureAssistant();
await sidebar.fill('#userPromptText', 'this call will fail');
await sidebar.click('#promptBtn');
await waitSidebar(() => document.querySelectorAll('#transcript .t-error').length >= 1, 15000);

transcriptEvents = await getTranscriptEvents();
const errorEvents = transcriptEvents.filter((e) => e.kind === 'error');
check('thrown loop error produces exactly one error Event', errorEvents.length === 1, JSON.stringify(errorEvents));
check(
  'thrown loop error adds no toolCall or assistant Event',
  transcriptEvents.filter((e) => e.kind === 'toolCall' || e.kind === 'assistant').length === 0,
  JSON.stringify(transcriptEvents),
);

await ensureAssistant();
await sidebar.click('#resetBtn');

// Restore pre-test state before unrouting: clear the fake API key through
// the real apiKeyBtn flow (empty string -> initGenAI() sets genAI back to
// undefined). Later tests navigate the demo tab repeatedly, which triggers
// sidebar.js's own haveNewTools -> suggestUserPrompt() side effect; without
// this, that would fire an unmocked, real request once the route below is
// removed, using an invalid key and failing the "no console errors" check.
sidebar.once('dialog', (dialog) => dialog.accept(''));
await ensureAssistant();
await sidebar.click('#apiKeyBtn');
await waitSidebar(() => document.getElementById('promptBtn').disabled);

await sidebar.unroute(/generativelanguage\.googleapis\.com/);

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
  // Hex branch, additive: the theme-coverage block normalises colours by
  // rasterising them to a 1x1 canvas and reading the pixel, which yields
  // #rrggbb. Chrome serialises color-mix() as `color(srgb ...)`, so parsing the
  // computed string directly is not an option there.
  const hexMatch = /^#([0-9a-f]{6})$/i.exec((str || '').trim());
  if (hexMatch) {
    const n = parseInt(hexMatch[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
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

// ---------------------------------------------------------------------------
// Issues 0002 / 0003: lost-result evidence and expand-to-raw, proven against a
// hand-written fixture. The classification itself is unit-level (a narrow regex
// on Chrome's cross-origin message); reproducing that error end-to-end would
// need a second origin, which this single-origin fixture server cannot provide.
// See the note in the run summary.
// ---------------------------------------------------------------------------
// #transcript lives inside #mode-assistant, so visibility can only be measured
// with Assistant mode showing — runTool() above left us in Inspector mode.
await ensureAssistant();
const raw = await sidebar.evaluate(async () => {
  const T = await import('./transcript.js');
  T.reset();
  T.append('toolCall', {
    toolName: 'search-optimizely-site',
    status: 'lost',
    errorMessage: 'Cannot return tool results after a cross-origin navigation',
    frameId: 0,
    urlBefore: '/search?topic=AI&product=Opal',
    urlAfter: '/?search=Opal',
    durationMs: 1240,
    proposedArgs: { query: 'Opal' },
    sentArgs: { query: 'Opal' },
    inputSchema: '{"type":"object"}',
  });
  T.append('toolCall', {
    toolName: 'register-opticon-online-submit',
    status: 'ok',
    destructive: true,
    frameId: 2,
    result: 'ORDER-12345',
    urlBefore: '/x',
    urlAfter: '/x',
    durationMs: 88,
    proposedArgs: { a: 1 },
    sentArgs: { a: 2 },
  });
  const evs = [...document.querySelectorAll('#transcript details.t-ev')];
  const kv = (el) => {
    const out = {};
    const dl = el.querySelector('.t-kv');
    const dts = [...dl.querySelectorAll('dt')];
    const dds = [...dl.querySelectorAll('dd')];
    dts.forEach((dt, i) => (out[dt.textContent] = dds[i]?.textContent));
    return out;
  };
  // Chrome 150 hides <details> content via ::details-content / content-visibility,
  // NOT display:none on children — so getComputedStyle().display reports 'block'
  // for hidden content and is useless here. checkVisibility() is the real answer.
  const visible = (el) => el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
  return {
    lostClass: evs[0].className,
    hasHead: !!evs[0].querySelector('summary > .t-head'),
    lostEvidence: evs[0].querySelector('.t-evidence').textContent,
    lostEvidenceVisible: visible(evs[0].querySelector('.t-evidence')),
    lostPrecisVisible: visible(evs[0].querySelector('.precis')),
    lostStateLabel: evs[0].querySelector('.state')?.textContent,
    lostRawVisibleClosed: visible(evs[0].querySelector('.t-raw')),
    lostKv: kv(evs[0]),
    dstrClass: evs[1].className,
    dstrFlag: evs[1].querySelector('.dstr-flag')?.textContent,
    dstrKv: kv(evs[1]),
    dstrFrame: kv(evs[1]).frame,
  };
});
await sidebar.evaluate(async () => (await import('./transcript.js')).reset());

check('0002: summary carries a .t-head row', raw.hasHead === true, String(raw.hasHead));
check('0002: lost carries the lost class, not err', /\blost\b/.test(raw.lostClass) && !/\berr\b/.test(raw.lostClass), raw.lostClass);
check('0002: lost shows a text label, not colour alone', raw.lostStateLabel === 'lost', String(raw.lostStateLabel));
check('0002: lost evidence names the cause', raw.lostEvidence.includes('result lost to navigation'), raw.lostEvidence);
check('0002: lost evidence carries before AND after URLs', raw.lostEvidence.includes('/search?topic=AI&product=Opal') && raw.lostEvidence.includes('/?search=Opal'), raw.lostEvidence);
check('0002: lost evidence reads WITHOUT expanding', raw.lostEvidenceVisible === true, `evidenceVisible=${raw.lostEvidenceVisible}`);
check('0002: arg precis reads WITHOUT expanding', raw.lostPrecisVisible === true, `precisVisible=${raw.lostPrecisVisible}`);
check('0002: raw table stays hidden while collapsed', raw.lostRawVisibleClosed === false, `rawVisible=${raw.lostRawVisibleClosed}`);
check('0002: duration recorded', raw.lostKv.took === '1240ms', String(raw.lostKv.took));

check('0003: expanded shows verbatim proposed args', raw.lostKv.proposed === '{"query":"Opal"}', String(raw.lostKv.proposed));
check('0003: identical sent args marked identical', raw.lostKv.sent === 'identical', String(raw.lostKv.sent));
check('0003: differing sent args shown verbatim', raw.dstrKv.proposed === '{"a":1}' && raw.dstrKv.sent === '{"a":2}', `${raw.dstrKv.proposed} / ${raw.dstrKv.sent}`);
check('0003: verbatim result, byte for byte', raw.dstrKv.result === 'ORDER-12345', String(raw.dstrKv.result));
check('0003: unchanged URL reported as unchanged', String(raw.dstrKv.url).startsWith('unchanged'), String(raw.dstrKv.url));
check('0003: frame reported for a subframe call', raw.dstrFrame === 'frame 2', String(raw.dstrFrame));
check('0003: top frame reported as top', raw.lostKv.frame === 'top (0)', String(raw.lostKv.frame));
check('0003: declared schema surfaced', raw.lostKv.schema === '{"type":"object"}', String(raw.lostKv.schema));

check('0005: destructive tool flagged on the Event', /\bdstr\b/.test(raw.dstrClass) && (raw.dstrFlag || '').includes('submit'), `${raw.dstrClass} / ${raw.dstrFlag}`);

// ---------------------------------------------------------------------------
// Issue 0004: two modes. Issue 0005: opener chips.
// ---------------------------------------------------------------------------
await backToPage1();
await ensureAssistant();

const modeState = await sidebar.evaluate(() => ({
  assistantHidden: document.getElementById('mode-assistant').hasAttribute('hidden'),
  inspectorHidden: document.getElementById('mode-inspector').hasAttribute('hidden'),
  root: document.documentElement.dataset.mode,
  stored: localStorage.getItem('mode'),
  badge: document.getElementById('badge')?.textContent,
  chips: [...document.querySelectorAll('#chips .chip')].map((c) => ({ t: c.dataset.tool, d: c.className.includes('dstr') })),
  toolCount: document.querySelectorAll('#toolNames option').length,
}));

check('0004: Assistant mode is the default view', !modeState.assistantHidden && modeState.inspectorHidden, `assistantHidden=${modeState.assistantHidden} inspectorHidden=${modeState.inspectorHidden}`);
check('0004: WebMCP badge present in the strip', modeState.badge === 'WebMCP', String(modeState.badge));
check('0004: mode persisted to localStorage', modeState.stored === 'assistant', String(modeState.stored));

await ensureInspector();
const afterSwitch = await sidebar.evaluate(() => ({
  assistantHidden: document.getElementById('mode-assistant').hasAttribute('hidden'),
  inspectorHidden: document.getElementById('mode-inspector').hasAttribute('hidden'),
  stored: localStorage.getItem('mode'),
  tableVisible: getComputedStyle(document.getElementById('resultsTable')).display !== 'none',
}));
check('0004: switching reveals Inspector and hides Assistant', afterSwitch.inspectorHidden === false && afterSwitch.assistantHidden === true, JSON.stringify(afterSwitch));
check('0004: Inspector switch persisted', afterSwitch.stored === 'inspector', String(afterSwitch.stored));
check('0004: upstream tool table still renders in Inspector', afterSwitch.tableVisible);

check('0005: one chip per registered tool', modeState.chips.length === modeState.toolCount && modeState.chips.length >= 6, `chips=${modeState.chips.length} tools=${modeState.toolCount}`);
check('0005: submit-shaped tool flagged destructive', modeState.chips.some((c) => c.t === 'submit_order' && c.d), JSON.stringify(modeState.chips));
check('0005: read tool not flagged destructive', modeState.chips.some((c) => c.t === 'add_numbers' && !c.d), JSON.stringify(modeState.chips));

const clicked = await sidebar.evaluate(() => {
  const before = document.querySelectorAll('#transcript details.t-ev').length;
  document.querySelector('#chips .chip').click();
  return { before, after: document.querySelectorAll('#transcript details.t-ev').length, prompt: document.getElementById('userPromptText').value };
});
check('0005: clicking a chip fills the composer and executes nothing', clicked.after === clicked.before && clicked.prompt.length > 0, JSON.stringify(clicked));

const manifestName = await sidebar.evaluate(() => chrome.runtime.getManifest().name);
check('0004: extension renamed', manifestName === 'AI Agent in Browser', manifestName);

await ensureAssistant();


// ---------------------------------------------------------------------------
// Direction B reaches the Assistant-mode markup.
//
// theme.css was authored against upstream's DOM only, so it originally styled
// none of the Transcript / chips / strip elements — the theme "passed" while
// direction B was invisible on the new UI. These assertions read computed
// styles, so a token that never reaches an element fails here.
//
// Colours are normalised through a canvas fillStyle rather than parsed from
// the computed string: theme.css derives every tint with color-mix(), and
// Chrome is free to serialise that as rgb(), color(srgb ...) or oklab(). Canvas
// normalisation collapses all of them to #rrggbb.
// ---------------------------------------------------------------------------
await ensureAssistant();

const readThemeCoverage = () =>
  sidebar.evaluate(async () => {
    // One Event of every kind and every status, so no measured selector can be
    // absent. Built here rather than passed in as a code string: the extension
    // page's CSP blocks eval().
    const T = await import('./transcript.js');
    T.reset();
    T.append('user', { text: 'ship it' });
    // Markdown, so the prose styling is measured alongside everything else
    // rather than being the one unverified surface.
    T.append('assistant', {
      text: '#### Result\ncalling `three` tools with a [link](https://a.test) and **bold**\n\n> aside',
    });
    T.append('toolCall', { toolName: 'read_notes', status: 'ok', sentArgs: { q: 'x' }, durationMs: 12, frameId: 0 });
    T.append('toolCall', { toolName: 'go_checkout', status: 'lost', sentArgs: {}, urlBefore: 'https://a.test/1', urlAfter: 'https://a.test/2', durationMs: 300, frameId: 0 });
    // 'error', not 'err': 'err' is the CLASS transcript.js derives, not the
    // status value. Passing the class name yields no class at all.
    T.append('toolCall', { toolName: 'submit_order', status: 'error', destructive: true, sentArgs: { qty: 3 }, errorMessage: 'boom', durationMs: 40, frameId: 0 });
    T.append('toolCall', { toolName: 'pending_tool', sentArgs: {} });
    T.append('error', { text: 'loop failed' });
    T.append('warning', { text: 'heads up' });

    // Rasterise, then read the pixel back. Normalising via `ctx.fillStyle`
    // alone is not enough: Chrome serialises color-mix() output as
    // `color(srgb 0.1 0.2 0.3)`, which no rgb() parser reads. A 1x1 fillRect
    // plus getImageData returns the actual 8-bit channels for every syntax.
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const hex = (s) => {
      if (!s) return null;
      // Two sentinels: an unparseable value leaves fillStyle untouched, so
      // report null rather than silently measuring the sentinel.
      ctx.fillStyle = '#010203';
      ctx.fillStyle = s;
      const first = ctx.fillStyle;
      ctx.fillStyle = '#040506';
      ctx.fillStyle = s;
      if (first !== ctx.fillStyle) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      // A non-opaque result means there is no honest background to measure
      // against — fail loudly instead of compositing onto transparent black.
      if (a !== 255) return null;
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    const q = (sel) => document.querySelector(sel);
    const cs = (sel, prop, pseudo) => {
      const el = q(sel);
      return el ? getComputedStyle(el, pseudo)[prop] : null;
    };
    const pair = (sel) => {
      const el = q(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { fg: hex(s.color), bg: hex(s.backgroundColor) };
    };
    // Text on an element with a transparent background sits on its nearest
    // painted ancestor, so resolve upward rather than measuring rgba(0,0,0,0).
    const onto = (sel, ancestorSel) => {
      const el = q(sel);
      const anc = q(ancestorSel);
      if (!el || !anc) return null;
      return { fg: hex(getComputedStyle(el).color), bg: hex(getComputedStyle(anc).backgroundColor) };
    };
    return {
      theme: document.documentElement.dataset.theme ?? 'system',
      // Stripe = status channel. Four distinct values means the class is wired.
      stripePending: hex(cs('#transcript details.t-ev:not(.ok):not(.lost):not(.err)', 'borderLeftColor')),
      stripeOk: hex(cs('#transcript details.t-ev.ok', 'borderLeftColor')),
      stripeLost: hex(cs('#transcript details.t-ev.lost', 'borderLeftColor')),
      stripeErr: hex(cs('#transcript details.t-ev.err', 'borderLeftColor')),
      // Panel geometry from --radius-panel, not upstream's 8px.
      transcriptRadius: cs('#transcript', 'borderTopLeftRadius'),
      transcriptBg: hex(cs('#transcript', 'backgroundColor')),
      // A themed .t-ev must not be sitting on the page ground unpainted.
      evBg: hex(cs('#transcript details.t-ev.ok', 'backgroundColor')),
      // .t-raw and upstream's <pre> both draw --prebg: proof of a shared token.
      rawBg: hex(cs('#transcript .t-raw', 'backgroundColor')),
      preBg: hex(cs('#toolResults', 'backgroundColor')),
      // A chip must NOT still be wearing the solid accent button fill.
      chipBg: hex(cs('#chips .chip', 'backgroundColor')),
      badgeBg: hex(cs('#badge', 'backgroundColor')),
      accentBg: hex(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),
      // Machine text is mono, prose is not.
      toolFont: cs('#transcript .t-ev .tool', 'fontFamily'),
      assistFont: cs('#transcript .t-assist', 'fontFamily'),
      // .state must track the stripe custom property, not a literal.
      stateErr: hex(cs('#transcript details.t-ev.err .state', 'color')),
      contrast: {
        'ok state': { fg: hex(cs('#transcript details.t-ev.ok .state', 'color')), bg: hex(cs('#transcript details.t-ev.ok', 'backgroundColor')) },
        'lost state': { fg: hex(cs('#transcript details.t-ev.lost .state', 'color')), bg: hex(cs('#transcript details.t-ev.lost', 'backgroundColor')) },
        'err state': { fg: hex(cs('#transcript details.t-ev.err .state', 'color')), bg: hex(cs('#transcript details.t-ev.err', 'backgroundColor')) },
        'MCP tag': pair('#transcript .t-ev .who'),
        'destructive pill': pair('#transcript .t-ev .dstr-flag'),
        'user bubble': pair('#transcript .t-user'),
        'arg precis': { fg: hex(cs('#transcript .t-ev .precis', 'color')), bg: hex(cs('#transcript details.t-ev.ok', 'backgroundColor')) },
        'lost evidence': { fg: hex(cs('#transcript details.t-ev.lost .t-evidence', 'color')), bg: hex(cs('#transcript details.t-ev.lost', 'backgroundColor')) },
        'raw key': { fg: hex(cs('#transcript .t-kv dt', 'color')), bg: hex(cs('#transcript .t-raw', 'backgroundColor')) },
        'raw value': { fg: hex(cs('#transcript .t-kv dd', 'color')), bg: hex(cs('#transcript .t-raw', 'backgroundColor')) },
        chip: pair('#chips .chip'),
        badge: pair('#badge'),
        'transcript error line': pair('#transcript .t-error'),
        'transcript warning line': pair('#transcript .t-warning'),
        'inactive mode tab': onto('#modes button.secondary', 'body'),
        'prose inline code': pair('#transcript .t-assist .md-code'),
        'prose link': onto('#transcript .t-assist .md-link', '#transcript'),
        'prose quote': onto('#transcript .t-assist .md-quote', '#transcript'),
        'prose small heading': onto('#transcript .t-assist .md-h[data-level="4"]', '#transcript'),
        'prose bold': onto('#transcript .t-assist strong', '#transcript'),
      },
    };
  });

// Pin the theme rather than inheriting it: an earlier block leaves the panel on
// the dark toggle, so measuring "light" ambiently measured the dark palette and
// every light assertion was a lie that happened to pass.
await sidebar.evaluate(() => {
  document.documentElement.dataset.theme = 'light';
});
const themeLight = await readThemeCoverage();
check('theme: light toggle applied', themeLight.theme === 'light', String(themeLight.theme));

const stripesLight = [themeLight.stripePending, themeLight.stripeOk, themeLight.stripeLost, themeLight.stripeErr];
check(
  'theme: .t-ev stripe is wired to the status class (4 distinct colours)',
  // `.every(Boolean)` matters: a missing selector returns null, and a null
  // counted as the fourth distinct "colour" once already.
  stripesLight.every(Boolean) && new Set(stripesLight).size === 4,
  JSON.stringify(stripesLight),
);
check('theme: .state colour follows the stripe token', themeLight.stateErr === themeLight.stripeErr, `${themeLight.stateErr} vs ${themeLight.stripeErr}`);
check('theme: #transcript uses --radius-panel (14px)', themeLight.transcriptRadius === '14px', String(themeLight.transcriptRadius));
check('theme: #transcript and .t-ev are painted, not transparent', !!themeLight.transcriptBg && !!themeLight.evBg && themeLight.transcriptBg !== themeLight.evBg, `panel=${themeLight.transcriptBg} row=${themeLight.evBg}`);
check('theme: .t-raw shares --prebg with upstream <pre>', themeLight.rawBg === themeLight.preBg, `raw=${themeLight.rawBg} pre=${themeLight.preBg}`);
check('theme: chips dropped the solid accent button fill', themeLight.chipBg !== themeLight.accentBg, `chip=${themeLight.chipBg} accent=${themeLight.accentBg}`);
check('theme: #badge draws the accent token', themeLight.badgeBg === themeLight.accentBg, `badge=${themeLight.badgeBg} accent=${themeLight.accentBg}`);
check('theme: machine rows are mono, prose is not', /mono|menlo|consolas/i.test(themeLight.toolFont) && !/mono|menlo|consolas/i.test(themeLight.assistFont), `${themeLight.toolFont} | ${themeLight.assistFont}`);

for (const [label, p] of Object.entries(themeLight.contrast)) {
  check(`theme light: ${label} colours resolved`, !!(p && p.fg && p.bg), JSON.stringify(p));
  if (p && p.fg && p.bg) checkContrast(`theme light: ${label}`, p.fg, p.bg);
}

// Same measurements with the manual dark toggle engaged. Dark is a token
// redefinition only, so every rule above must still hold.
await sidebar.evaluate(() => {
  document.documentElement.dataset.theme = 'dark';
});
const themeDark = await readThemeCoverage();
check('theme: dark toggle applied', themeDark.theme === 'dark', String(themeDark.theme));
const stripesDark = [themeDark.stripePending, themeDark.stripeOk, themeDark.stripeLost, themeDark.stripeErr];
check(
  'theme dark: stripe still wired to the status class',
  stripesDark.every(Boolean) && new Set(stripesDark).size === 4,
  JSON.stringify(stripesDark),
);
check('theme dark: tokens actually changed (not stuck on the light palette)', themeDark.evBg !== themeLight.evBg && themeDark.badgeBg !== themeLight.badgeBg, `ev ${themeLight.evBg}->${themeDark.evBg} badge ${themeLight.badgeBg}->${themeDark.badgeBg}`);
for (const [label, p] of Object.entries(themeDark.contrast)) {
  check(`theme dark: ${label} colours resolved`, !!(p && p.fg && p.bg), JSON.stringify(p));
  if (p && p.fg && p.bg) checkContrast(`theme dark: ${label}`, p.fg, p.bg);
}
await sidebar.evaluate(() => {
  delete document.documentElement.dataset.theme;
});
// ---------------------------------------------------------------------------
// Assistant prose is rendered Markdown (markdown.js), not literal source.
//
// The fixture is the exact text a real run produced and that reported the bug:
// it arrived as one run-on line of literal ### and **, because .t-assist used
// textContent and nothing set white-space.
// ---------------------------------------------------------------------------
const PROSE = [
  "The form has been filled out with Jane Doe's details and submitted.",
  '### Submitted Information:',
  '- **First Name:** Jane',
  '- **Last Name:** Doe',
  '- **Work Email:** jane.doe@example.com',
  '  - nested detail with `inline_code`',
  '',
  '1. first step',
  '2. second step',
  '',
  '> a quoted aside',
  '',
  '```js',
  'const x = **not bold**;',
  '```',
  '',
  '**Status:** Submitted successfully (Confirmation received: *"Submitting..."*).',
].join('\n');

// Untrusted by construction: assistant text is model output relaying page
// content. markdown.js builds DOM with createElement/createTextNode only, so
// this must come out as visible text and create no elements.
const HOSTILE = '<img src=x onerror="alert(1)"> then <script>bad()</script> then [click](javascript:alert(1))';

const prose = await sidebar.evaluate(async ([md, hostile]) => {
  const T = await import('./transcript.js');
  T.reset();
  T.append('assistant', { text: md });
  T.append('user', { text: 'line one\nline two' });
  T.append('assistant', { text: hostile });
  const nodes = [...document.querySelectorAll('#transcript .t-assist')];
  const first = nodes[0];
  const last = nodes[1];
  const userEl = document.querySelector('#transcript .t-user');
  return {
    // Literal markers must be gone from PROSE — but not from inside a fenced
    // block, where preserving them verbatim is the correct behaviour. Measure
    // the text with the fences excised, or this contradicts the fence check.
    text: (() => {
      const clone = first.cloneNode(true);
      clone.querySelectorAll('.md-pre').forEach((el) => el.remove());
      return clone.textContent;
    })(),
    headings: [...first.querySelectorAll('.md-h')].map((h) => [h.dataset.level, h.textContent]),
    // `:scope >` matters: the nested <ul> is also .md-list, so a bare
    // `ul.md-list > li` counts nested items as top-level ones too.
    ulItems: [...first.querySelectorAll(':scope > ul.md-list > li')].map((li) => li.firstChild?.textContent ?? ''),
    nestedItems: [...first.querySelectorAll('ul.md-list ul.md-list > li')].map((li) => li.textContent),
    olItems: [...first.querySelectorAll('ol.md-list > li')].map((li) => li.textContent),
    strongs: [...first.querySelectorAll('strong')].map((e) => e.textContent),
    ems: [...first.querySelectorAll('em')].map((e) => e.textContent),
    inlineCode: [...first.querySelectorAll('.md-code')].map((e) => e.textContent),
    fenced: first.querySelector('.md-pre code')?.textContent,
    quote: first.querySelector('.md-quote')?.textContent,
    // Real line breaks, not collapsed whitespace: compare rendered box height
    // to a single line's, which is what actually went wrong.
    userWhiteSpace: getComputedStyle(userEl).whiteSpace,
    userLines: (() => {
      const r = document.createRange();
      r.selectNodeContents(userEl);
      // Distinct vertical positions, not raw rect count: a Range spanning a
      // forced break yields an extra zero-width rect at the break itself, so
      // counting rects reports 3 for two lines.
      return new Set([...r.getClientRects()].map((rc) => Math.round(rc.top))).size;
    })(),
    // Hostile input: element count by tag, and whether the text survived.
    hostileTags: [...last.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).sort(),
    hostileText: last.textContent,
    hostileAnchors: last.querySelectorAll('a').length,
    hostileScripts: last.querySelectorAll('script, img, iframe, object, embed').length,
  };
}, [PROSE, HOSTILE]);

check('markdown: no literal ### or ** survives into the rendered text', !/###|\*\*/.test(prose.text), prose.text.slice(0, 120));
check('markdown: heading rendered with its level', JSON.stringify(prose.headings) === JSON.stringify([['3', 'Submitted Information:']]), JSON.stringify(prose.headings));
check('markdown: bullet list rendered as <ul><li>', prose.ulItems.length === 3 && prose.ulItems[0] === 'First Name:', JSON.stringify(prose.ulItems));
check('markdown: indented item nests instead of flattening', prose.nestedItems.length === 1 && prose.nestedItems[0].includes('nested detail'), JSON.stringify(prose.nestedItems));
check('markdown: numbered list rendered as <ol><li>', JSON.stringify(prose.olItems) === JSON.stringify(['first step', 'second step']), JSON.stringify(prose.olItems));
check('markdown: bold spans rendered as <strong>', prose.strongs.includes('First Name:') && prose.strongs.includes('Status:'), JSON.stringify(prose.strongs));
check('markdown: italic rendered as <em>', prose.ems.some((t) => t.includes('Submitting...')), JSON.stringify(prose.ems));
check('markdown: inline code rendered as <code>', JSON.stringify(prose.inlineCode) === JSON.stringify(['inline_code']), JSON.stringify(prose.inlineCode));
check('markdown: fenced block kept verbatim, markers NOT parsed inside it', prose.fenced === 'const x = **not bold**;', String(prose.fenced));
check('markdown: blockquote rendered', prose.quote === 'a quoted aside', String(prose.quote));

check('markdown: verbatim kinds keep newlines (white-space set)', /pre-wrap|pre-line/.test(prose.userWhiteSpace), prose.userWhiteSpace);
check('markdown: a two-line prompt actually occupies two lines', prose.userLines === 2, `lines=${prose.userLines}`);

check('markdown XSS: hostile input creates no live elements', prose.hostileScripts === 0 && prose.hostileAnchors === 0, JSON.stringify(prose.hostileTags));
check('markdown XSS: markup renders as visible text instead', prose.hostileText.includes('<img src=x onerror="alert(1)">') && prose.hostileText.includes('<script>bad()</script>'), prose.hostileText);
check('markdown XSS: a javascript: target is never an anchor', prose.hostileTags.every((t) => t !== 'a'), JSON.stringify(prose.hostileTags));

// Calm by default (context.md#Governing principle): an empty Transcript shows
// no panel at all. transcript.js always mounts a .t-flow wrapper, so the rule
// keys off an empty flow rather than :empty — worth asserting, because the
// obvious :empty version is silently dead.
const emptyPanel = await sidebar.evaluate(async () => {
  await (await import('./transcript.js')).reset();
  const el = document.getElementById('transcript');
  return { display: getComputedStyle(el).display, kids: el.querySelectorAll('.t-flow > *').length };
});
check('theme: empty Transcript renders no panel', emptyPanel.display === 'none' && emptyPanel.kids === 0, JSON.stringify(emptyPanel));

// ---------------------------------------------------------------------------
// Capability canary: what the Chrome Origin Trial actually puts on
// `annotations` (docs/adr/0004-forward-destructive-hint.md).
//
// page3.html registers four tools whose page-side declarations and
// sidebar.js#isDestructive verdicts deliberately DISAGREE, so nothing here can
// pass by coincidence. The headline assertion checks that `destructiveHint` is
// still absent — it asserts the absence of a platform feature, and is EXPECTED
// TO FAIL the day Chrome ships it. That failure is the signal to revisit the
// ADR, not something to loosen away.
// ---------------------------------------------------------------------------
await demo.bringToFront();
await demo.goto(`${BASE}/page3.html`);
await sidebar.bringToFront();
await waitSidebar(() => [...document.querySelectorAll('#toolNames option')].some((o) => o.textContent.includes('charge_card')), 20000);
await ensureAssistant();

// Read the OT in the page's own world, upstream of the extension entirely, so a
// null here cannot be blamed on content.js.
const otExposes = await demo.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  const pick = (name) => tools.find((t) => t.name === name);
  const keysOf = (t) => (t && t.annotations ? Object.keys(t.annotations).sort() : null);
  return {
    names: tools.map((t) => t.name).sort(),
    chargeCardKeys: keysOf(pick('charge_card')),
    chargeCardDestructive: pick('charge_card')?.annotations?.destructiveHint ?? null,
    surveyDestructive: pick('submit_survey')?.annotations?.destructiveHint ?? null,
    deleteDraftReadOnly: pick('delete_draft')?.annotations?.readOnlyHint ?? null,
  };
});

check(
  'OT canary: annotations carries readOnlyHint (the hint the design relies on)',
  otExposes.deleteDraftReadOnly === true,
  JSON.stringify(otExposes),
);
check(
  'OT canary: annotations exposes ONLY readOnlyHint + untrustedContentHint',
  JSON.stringify(otExposes.chargeCardKeys) === JSON.stringify(['readOnlyHint', 'untrustedContentHint']),
  `charge_card declared destructiveHint:true; getTools() returned keys ${JSON.stringify(otExposes.chargeCardKeys)}`,
);
check(
  'OT canary: destructiveHint still absent — see docs/adr/0004 before "fixing" this',
  otExposes.chargeCardDestructive === null && otExposes.surveyDestructive === null,
  `If these are non-null, Chrome now exposes destructiveHint: revisit ADR-0004. ${JSON.stringify(otExposes)}`,
);

// Given that gap, these pin down exactly how much the marker can and cannot do.
const annotated = await sidebar.evaluate(() => ({
  chips: Object.fromEntries(
    [...document.querySelectorAll('#chips .chip')].map((c) => [c.dataset.tool, c.className.includes('dstr')]),
  ),
  flags: Object.fromEntries(
    [...document.querySelectorAll('#chips .chip')].map((c) => [c.dataset.tool, c.textContent.startsWith('❗')]),
  ),
}));

check('destructive: readOnlyHint CLEARS a delete-shaped name', annotated.chips.delete_draft === false, JSON.stringify(annotated));
check('destructive: heuristic still flags a submit-shaped name', annotated.chips.submit_survey === true && annotated.flags.submit_survey === true, JSON.stringify(annotated));
check('destructive: undeclared, benign-named tool is not flagged', annotated.chips.wipe_cache === false, JSON.stringify(annotated));
// The documented limitation, asserted so it stays documented: a page declaring
// destructiveHint:true gets NO marker, because the declaration never arrives.
check(
  'destructive: KNOWN GAP — a page cannot flag its own tool (declaration unreachable)',
  annotated.chips.charge_card === false,
  `charge_card declares destructiveHint:true and is still unflagged: ${JSON.stringify(annotated)}`,
);

// The Inspector table must show the two real hints and nothing invented.
await ensureInspector();
const annotationColumns = await sidebar.evaluate(() => {
  const heads = [...document.querySelectorAll('#tableHeaderRow th')].map((t) => t.textContent);
  const nameCol = heads.indexOf('name');
  const roCol = heads.indexOf('readOnlyHint');
  const rows = [...document.querySelectorAll('#tableBody tr')].map((r) => {
    const cells = [...r.children].map((c) => c.textContent.trim());
    return [cells[nameCol], cells[roCol]];
  });
  return { heads, readOnly: Object.fromEntries(rows) };
});
check('Inspector: no destructiveHint column (nothing populates it)', !annotationColumns.heads.includes('destructiveHint'), JSON.stringify(annotationColumns.heads));
check('Inspector: readOnlyHint column reflects the declaration', annotationColumns.readOnly.delete_draft === '✓', JSON.stringify(annotationColumns.readOnly));
// Undeclared cells render blank, not the string "undefined": an absent hint
// arrives as a missing key, and textContent stringifies undefined.
check('Inspector: an undeclared hint renders blank, not "undefined"', annotationColumns.readOnly.wipe_cache === '', JSON.stringify(annotationColumns.readOnly));
await ensureAssistant();

await context.close();
server.close();


console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
