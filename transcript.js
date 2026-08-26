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
  if (status === 'error') return '✗';
  return '…'; // pending: the call has started but not yet resolved
}

function statusClass(status) {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'err';
  return '';
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
  details.className = ['t-ev', statusClass(event.status)].filter(Boolean).join(' ');

  const summary = document.createElement('summary');

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = 'MCP';
  summary.appendChild(who);

  const tool = document.createElement('span');
  tool.className = 'tool';
  tool.textContent = `${statusIcon(event.status)} ${event.toolName ?? ''}`;
  summary.appendChild(tool);

  const ms = document.createElement('span');
  ms.className = 'ms';
  // Duration capture is issue 0002 (the executeTool wrapper). The element is
  // reserved here so 0002 has nothing to restructure, only populate.
  ms.textContent = typeof event.durationMs === 'number' ? `${event.durationMs}ms` : '';
  summary.appendChild(ms);

  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = '▸';
  summary.appendChild(chev);

  details.appendChild(summary);

  const precis = document.createElement('div');
  precis.className = 'precis';
  precis.textContent = argsPrecis(event.sentArgs ?? event.proposedArgs);
  details.appendChild(precis);

  // Reserved for later issues; deliberately left empty here.
  const evidence = document.createElement('div');
  evidence.className = 't-evidence';
  details.appendChild(evidence);

  const raw = document.createElement('div');
  raw.className = 't-raw';
  const kv = document.createElement('dl');
  kv.className = 't-kv';
  raw.appendChild(kv);
  details.appendChild(raw);

  return details;
}
