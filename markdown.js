/**
 * markdown.js — a deliberately small Markdown renderer for assistant prose.
 *
 * Why this exists: the model writes Markdown, and .t-assist rendered it with
 * `textContent`, so a formatted answer arrived as a run-on line of literal
 * `###` and `**`. Replacing upstream's `<pre id="promptResults">` (which carried
 * `white-space: pre-line`, styles.css:48) with a `<div>` had also silently
 * dropped newline handling, so even unformatted multi-line prose collapsed.
 *
 * SECURITY — the load-bearing constraint. Assistant text is model output that
 * relays page content, i.e. untrusted. This module therefore builds DOM with
 * createElement/createTextNode ONLY. There is no innerHTML, no
 * insertAdjacentHTML, no template-string-to-HTML step anywhere, and no code
 * path that turns input into markup. Angle brackets in the source are text and
 * stay text. Do not "simplify" this by reaching for innerHTML.
 *
 * Deliberately NOT supported, and not by accident:
 *  - **Links are never anchors.** `[text](url)` renders the text with the URL on
 *    a `title`, not a clickable element. This tool's stance is flag-never-act
 *    (context.md#Destructive tool); a clickable link written by a model that
 *    just read an untrusted page is an outward-facing action, and it would also
 *    reintroduce a `javascript:` URL surface for no benefit in a devtool.
 *  - Raw/inline HTML — rendered as literal text.
 *  - Tables, footnotes, reference links, setext headings, task lists.
 *
 * The renderer is a pure function of a string: no chrome.* APIs, no network, no
 * DOM reads. Same property that makes transcript.js testable from a fixture.
 */

const MAX_DEPTH = 6;

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^\s{0,3}(`{3,}|~{3,})\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
// Checked before the list rules: `---` is a rule, `- x` is a list item.
const HR = /^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const UL = /^(\s*)[-*+][ \t]+(.*)$/;
const OL = /^(\s*)\d{1,9}[.)][ \t]+(.*)$/;

/** Render Markdown source into a DocumentFragment. */
export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  for (const block of parseBlocks(String(text ?? '').split(/\r?\n/))) {
    const el = renderBlock(block);
    if (el) frag.appendChild(el);
  }
  return frag;
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    let m = FENCE_OPEN.exec(line);
    if (m) {
      const marker = m[1][0];
      const body = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]);
        if (close && close[1][0] === marker) break;
        body.push(lines[i++]);
      }
      i++; // the closing fence, or past the end for an unterminated block
      blocks.push({ type: 'code', lang: m[2], lines: body });
      continue;
    }

    m = HEADING.exec(line);
    if (m) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2] });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    m = QUOTE.exec(line);
    if (m) {
      const quoted = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i]);
        if (!q) break;
        quoted.push(q[1]);
        i++;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    if (UL.test(line) || OL.test(line)) {
      const items = [];
      while (i < lines.length) {
        const ul = UL.exec(lines[i]);
        const ol = ul ? null : OL.exec(lines[i]);
        if (!ul && !ol) break;
        const hit = ul ?? ol;
        items.push({ ordered: !ul, indent: hit[1].replace(/\t/g, '  ').length, text: hit[2] });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      if (
        !l.trim() ||
        FENCE_OPEN.test(l) ||
        HEADING.test(l) ||
        HR.test(l) ||
        QUOTE.test(l) ||
        UL.test(l) ||
        OL.test(l)
      ) {
        break;
      }
      para.push(l);
      i++;
    }
    blocks.push({ type: 'para', lines: para });
  }
  return blocks;
}

function renderBlock(block) {
  switch (block.type) {
    case 'code': {
      const pre = document.createElement('pre');
      pre.className = 'md-pre';
      const code = document.createElement('code');
      if (block.lang) code.dataset.lang = block.lang;
      code.textContent = block.lines.join('\n');
      pre.appendChild(code);
      return pre;
    }
    case 'heading': {
      // A div, not <h1>-<h6>: styles.css already styles `h2`, and this is a
      // log line rather than document structure. One class, no cascade fight.
      const el = document.createElement('div');
      el.className = 'md-h';
      el.dataset.level = String(block.level);
      el.appendChild(renderInline(block.text, 0));
      return el;
    }
    case 'hr':
      return Object.assign(document.createElement('hr'), { className: 'md-hr' });
    case 'quote': {
      const el = document.createElement('div');
      el.className = 'md-quote';
      el.appendChild(renderInline(block.lines.join('\n'), 0));
      return el;
    }
    case 'list':
      return renderList(block.items);
    case 'para': {
      const el = document.createElement('p');
      el.className = 'md-p';
      el.appendChild(renderInline(block.lines.join('\n'), 0));
      return el;
    }
    default:
      return null;
  }
}

function newList(ordered) {
  const el = document.createElement(ordered ? 'ol' : 'ul');
  el.className = 'md-list';
  return el;
}

/** Build a (possibly nested) list from flat items carrying their indent. */
function renderList(items) {
  if (!items.length) return null;
  const root = newList(items[0].ordered);
  const stack = [{ indent: items[0].indent, el: root }];
  for (const item of items) {
    while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];
    if (item.indent > top.indent) {
      const sub = newList(item.ordered);
      // Nest inside the preceding <li> when there is one, so the markup stays
      // valid rather than hanging a bare list off a <ul>.
      (top.el.lastElementChild ?? top.el).appendChild(sub);
      stack.push({ indent: item.indent, el: sub });
    }
    const li = document.createElement('li');
    li.appendChild(renderInline(item.text, 0));
    stack[stack.length - 1].el.appendChild(li);
  }
  return root;
}

function wrap(tag, inner, depth) {
  const el = document.createElement(tag);
  el.appendChild(renderInline(inner, depth));
  return el;
}

function codeSpan(text) {
  const el = document.createElement('code');
  el.className = 'md-code';
  el.textContent = text.replace(/^ | $/g, '');
  return el;
}

/**
 * `[text](url)` -> the text, with the URL on a title. Never an <a>: see the
 * module header. The URL is only ever assigned to an attribute as a string, so
 * a `javascript:` target has nothing to activate.
 */
function linkish(label, url, depth) {
  const el = document.createElement('span');
  el.className = 'md-link';
  el.appendChild(renderInline(label, depth));
  el.title = url;
  return el;
}

// Order matters: code before everything (so markers inside backticks stay
// literal), and the doubled markers before their single-character forms.
const INLINE_RULES = [
  { re: /^(`+)([^`]+)\1/, build: (m) => codeSpan(m[2]) },
  // The URL allows one level of nested parens, so `(...)` inside a target does
  // not truncate it and leak the tail into the surrounding text.
  { re: /^!?\[([^\]\n]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\s*\)/, build: (m, d) => linkish(m[1], m[2], d) },
  { re: /^\*\*(?=\S)([\s\S]*?\S)\*\*/, build: (m, d) => wrap('strong', m[1], d) },
  { re: /^__(?=\S)([\s\S]*?\S)__/, build: (m, d) => wrap('strong', m[1], d) },
  { re: /^~~(?=\S)([\s\S]*?\S)~~/, build: (m, d) => wrap('s', m[1], d) },
  { re: /^\*(?=\S)([^*\n]*\S)\*/, build: (m, d) => wrap('em', m[1], d) },
  { re: /^_(?=\S)([^_\n]*\S)_/, build: (m, d) => wrap('em', m[1], d) },
];

const SPECIAL = /[\\`*_~[!\n]/;
const ESCAPABLE = /^[\\`*_~[\]()#+\-.!>]/;

function renderInline(text, depth) {
  const frag = document.createDocumentFragment();
  let rest = String(text ?? '');
  let buf = '';
  const flush = () => {
    if (buf) {
      frag.appendChild(document.createTextNode(buf));
      buf = '';
    }
  };

  while (rest) {
    if (rest[0] === '\\' && ESCAPABLE.test(rest[1] ?? '')) {
      buf += rest[1];
      rest = rest.slice(2);
      continue;
    }
    if (rest[0] === '\n') {
      // A soft break inside a block. The whole reason the pasted example arrived
      // as one line: `white-space: normal` collapses these, so make them real.
      flush();
      frag.appendChild(document.createElement('br'));
      rest = rest.slice(1);
      continue;
    }

    let matched = false;
    if (depth < MAX_DEPTH) {
      for (const rule of INLINE_RULES) {
        const m = rule.re.exec(rest);
        if (m) {
          flush();
          frag.appendChild(rule.build(m, depth + 1));
          rest = rest.slice(m[0].length);
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    // No rule fired here. Consume in bulk up to the next candidate marker
    // rather than one character at a time, which would be quadratic on prose.
    const next = rest.slice(1).search(SPECIAL);
    const take = next === -1 ? rest.length : next + 1;
    buf += rest.slice(0, take);
    rest = rest.slice(take);
  }

  flush();
  return frag;
}
