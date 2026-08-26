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
      precis: e.querySelector(':scope > .precis')?.textContent,
      hasEvidence: !!e.querySelector(':scope > .t-evidence'),
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
check('transcript fixture: .precis present (visible collapsed)', fixture.evStructure.every((s) => typeof s.precis === 'string'), JSON.stringify(fixture.evStructure));
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

await sidebar.click('#resetBtn');

// Restore pre-test state before unrouting: clear the fake API key through
// the real apiKeyBtn flow (empty string -> initGenAI() sets genAI back to
// undefined). Later tests navigate the demo tab repeatedly, which triggers
// sidebar.js's own haveNewTools -> suggestUserPrompt() side effect; without
// this, that would fire an unmocked, real request once the route below is
// removed, using an invalid key and failing the "no console errors" check.
sidebar.once('dialog', (dialog) => dialog.accept(''));
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

// No console errors or unhandled rejections anywhere
const relevantErrors = consoleErrors.filter((e) => !e.includes('net::'));
check('no console errors', relevantErrors.length === 0, relevantErrors.join(' | ') || 'clean');

await context.close();
server.close();

console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
