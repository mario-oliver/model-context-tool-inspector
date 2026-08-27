/**
 * The Transcript: an append-only store of typed Events, plus a renderer that
 * mounts them into a container element.
 *
 * See context.md#Transcript and context.md#Event for the ubiquitous language.
 * This module is intentionally free of chrome.* APIs, the Gemini SDK, and any
 * network access — it renders from the Event model only (context.md#Transcript:
 * "It never reads agent state directly."). That is what makes it testable with
 * a hand-written fixture array and nothing else running.
 *
 * Event kinds (issue 0001): 'user' | 'assistant' | 'toolCall' | 'error' | 'warning'.
 * Tool call status (issue 0001): 'ok' | 'error'. ('lost' arrives in issue 0002,
 * alongside urlBefore/urlAfter/durationMs — not populated here.)
 */

let container = null;
let events = [];
let seq = 0;

/** Mount the Transcript into a container element and render its current state. */
export function mount(el) {
  container = el;
  render();
}

/** Clear all Events and the rendered Transcript. Wired to the Reset control. */
export function reset() {
  events = [];
  seq = 0;
  render();
}

/**
 * Append a new Event of the given kind and re-render.
 * Returns the created Event so a tool-call's later `update()` can find it —
 * this is how the two `logPrompt()` call sites for a single tool call (the
 * "calling tool" boundary and the "result"/"error" boundary) end up as one
 * Event and one `<details class="t-ev">` row.
 */
export function append(kind, data = {}) {
  const event = { kind, seq: seq++, ...data };
  events.push(event);
  render();
  return event;
}

/** Update an existing Event in place (used to resolve a pending tool call) and re-render. */
export function update(event, data) {
  Object.assign(event, data);
  render();
  return event;
}

/** The current Events, in order. Read-only snapshot for tests and diagnostics. */
export function getEvents() {
  return events.slice();
}

function render() {
  if (!container) return;
  container.textContent = '';
  const flow = document.createElement('div');
  flow.className = 't-flow';
  for (const event of events) {
    const el = renderEvent(event);
    if (el) flow.appendChild(el);
  }
  container.appendChild(flow);
  container.scrollTop = container.scrollHeight;
}

function renderEvent(event) {
  switch (event.kind) {
    case 'user':
      return renderLine(event, 't-user');
    case 'assistant':
      return renderLine(event, 't-assist');
    case 'error':
      return renderLine(event, 't-error');
    case 'warning':
      return renderLine(event, 't-warning');
    case 'toolCall':
      return renderToolCall(event);
    default:
      return null;
  }
}

function renderLine(event, className) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = event.text ?? '';
  return div;
}

function statusIcon(status) {
  if (status === 'ok') return '✓';
  if (status === 'lost') return '⚠';
  if (status === 'error') return '✗';
  return '…'; // pending: the call has started but not yet resolved
}

function statusClass(status) {
  if (status === 'ok') return 'ok';
  if (status === 'lost') return 'lost';
  if (status === 'error') return 'err';
  return '';
}

/**
 * Short word shown beside the icon. Status is never carried by colour alone —
 * icon + label keeps it legible in both themes and without colour vision.
 */
function statusLabel(status) {
  if (status === 'ok') return 'ok';
  if (status === 'lost') return 'lost';
  if (status === 'error') return 'error';
  return 'running';
}

function argsPrecis(args) {
  if (args === undefined) return '';
  let json;
  try {
    json = JSON.stringify(args);
  } catch {
    return String(args);
  }
  return json.length > 140 ? `${json.slice(0, 137)}...` : json;
}

function renderToolCall(event) {
  const details = document.createElement('details');
  details.className = ['t-ev', statusClass(event.status), event.destructive ? 'dstr' : '']
    .filter(Boolean)
    .join(' ');

  const summary = document.createElement('summary');

  // The header row lives in its own flex container because <summary> now also
  // holds the precis and evidence. Everything inside <summary> is visible while
  // collapsed; everything outside it is not — see the note on .t-raw below.
  const head = document.createElement('div');
  head.className = 't-head';

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = 'MCP';
  head.appendChild(who);

  const tool = document.createElement('span');
  tool.className = 'tool';
  tool.textContent = `${statusIcon(event.status)} ${event.toolName ?? ''}`;
  head.appendChild(tool);

  const label = document.createElement('span');
  label.className = 'state';
  label.textContent = statusLabel(event.status);
  head.appendChild(label);

  if (event.destructive) {
    const flag = document.createElement('span');
    flag.className = 'dstr-flag';
    flag.textContent = '❗ submit';
    flag.title = 'Outward-facing side effects. Flagged only — nothing is intercepted.';
    head.appendChild(flag);
  }

  const ms = document.createElement('span');
  ms.className = 'ms';
  // Duration capture is issue 0002 (the executeTool wrapper). The element is
  // reserved here so 0002 has nothing to restructure, only populate.
  ms.textContent = typeof event.durationMs === 'number' ? `${event.durationMs}ms` : '';
  head.appendChild(ms);

  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = '▸';
  head.appendChild(chev);

  summary.appendChild(head);

  const precis = document.createElement('div');
  precis.className = 'precis';
  precis.textContent = argsPrecis(event.sentArgs ?? event.proposedArgs);
  summary.appendChild(precis);

  // Issue 0002: on a lost result the URL pair is the evidence that the call ran
  // and only its return value vanished — so it shows WITHOUT expanding.
  const evidence = document.createElement('div');
  evidence.className = 't-evidence';
  if (event.status === 'lost') {
    evidence.appendChild(line('ran · result lost to navigation'));
    if (event.urlBefore) evidence.appendChild(line(`before  ${event.urlBefore}`));
    if (event.urlAfter) evidence.appendChild(line(`after   ${event.urlAfter}`));
  }
  summary.appendChild(evidence);
  details.appendChild(summary);

  // Issue 0003: expand to raw. This one DOES sit outside <summary>, so the
  // native disclosure hides it until the row is opened. Verbatim, never summarised — a tool that reports
  // success while returning stale content is only visible here.
  const raw = document.createElement('div');
  raw.className = 't-raw';
  const kv = document.createElement('dl');
  kv.className = 't-kv';

  addRow(kv, 'schema', event.inputSchema);
  addRow(kv, 'proposed', json(event.proposedArgs));
  const proposed = json(event.proposedArgs);
  const sent = json(event.sentArgs);
  addRow(kv, 'sent', sent === proposed ? 'identical' : sent, sent === proposed);
  if (event.result !== undefined) addRow(kv, 'result', String(event.result));
  if (event.errorMessage) addRow(kv, 'error', event.errorMessage);
  addRow(kv, 'frame', frameLabel(event));
  addRow(
    kv,
    'url',
    event.urlBefore && event.urlBefore === event.urlAfter
      ? `unchanged · ${event.urlBefore}`
      : [event.urlBefore, event.urlAfter].filter(Boolean).join('  →  '),
    event.urlBefore !== undefined && event.urlBefore === event.urlAfter,
  );
  addRow(kv, 'took', typeof event.durationMs === 'number' ? `${event.durationMs}ms` : undefined);

  raw.appendChild(kv);
  details.appendChild(raw);

  return details;
}

function line(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function json(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function frameLabel(event) {
  if (typeof event.frameId !== 'number' || Number.isNaN(event.frameId)) return undefined;
  return event.frameId === 0 ? 'top (0)' : `frame ${event.frameId}`;
}

/** Add one dt/dd pair. Skips absent values so the table has no empty rows. */
function addRow(kv, key, value, muted = false) {
  if (value === undefined || value === '') return;
  const dt = document.createElement('dt');
  dt.textContent = key;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (muted) dd.className = 'same';
  kv.appendChild(dt);
  kv.appendChild(dd);
}
