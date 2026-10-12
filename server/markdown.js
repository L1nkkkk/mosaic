import { escape } from '../web/ui.js';

// A small Markdown renderer for posts. It only ever emits the tags written here:
// raw HTML in the source is shown as text, and addresses go through `link` and `image`.
const MAX_DEPTH = 8;
const CJK = /[⺀-鿿豈-﫿＀-￯]/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const DIVIDER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function externalLink(href) {
  try { const url = new URL(href); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}

function cells(line) {
  const row = line.trim().replace(/^\|/, '').replace(/\|$/, ''), values = []; let value = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') { value += '|'; i++; }
    else if (row[i] === '|') { values.push(value.trim()); value = ''; }
    else value += row[i];
  }
  values.push(value.trim());
  return values;
}

function closing(text, mark, from) {
  for (let at = text.indexOf(mark, from); at >= 0; at = text.indexOf(mark, at + 1)) {
    if (at === from || /\s/.test(text[at - 1]) || text[at - 1] === '\\') continue;
    // The last marks of a longer run close the span, so ***both*** nests cleanly.
    while (mark.length > 1 && text[at + mark.length] === mark[0]) at++;
    if (mark.length === 1 && (text[at + 1] === mark || text[at - 1] === mark)) continue;
    if (mark[0] === '_' && /[\p{L}\p{N}]/u.test(text[at + mark.length] || '')) continue;
    return at;
  }
  return -1;
}

function inline(text, context, depth = 0, linked = false) {
  let out = '', plain = '', i = 0;
  const flush = () => { out += escape(plain); plain = ''; };
  while (i < text.length) {
    const character = text[i], next = text[i + 1];
    if (character === '\\' && next === '\n') { flush(); out += '<br>\n'; i += 2; continue; }
    if (character === '\\' && next && /[!-/:-@[-`{-~]/.test(next)) { plain += next; i += 2; continue; }
    if (character === '\n') {
      const hard = / {2,}$/.test(plain); plain = plain.replace(/[ \t]+$/, '');
      // Wrapped Chinese text must not gain a space where the line broke.
      if (hard) { flush(); out += '<br>\n'; } else if (!(CJK.test(plain.at(-1) || '') && CJK.test(next || ''))) plain += '\n';
      i++; continue;
    }
    if (character === '`') {
      const run = /^`+/.exec(text.slice(i))[0]; let end = -1;
      for (const match of text.slice(i + run.length).matchAll(/`+/g)) if (match[0].length === run.length) { end = i + run.length + match.index; break; }
      if (end >= 0) { flush(); out += `<code>${escape(text.slice(i + run.length, end).replace(/\n/g, ' ').trim())}</code>`; i = end + run.length; continue; }
      plain += run; i += run.length; continue;
    }
    const picture = character === '!' && next === '[';
    if ((character === '[' && !linked) || picture) {
      const start = i + (picture ? 2 : 1); let level = 1, end = start;
      for (; end < text.length && level; end++) { if (text[end] === '\\') end++; else if (text[end] === '[') level++; else if (text[end] === ']') level--; }
      const target = level ? null : /^\([ \t\n]*(<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:[ \t\n]+(?:"([^"]*)"|'([^']*)'))?[ \t\n]*\)/.exec(text.slice(end));
      if (target) {
        const label = text.slice(start, end - 1), address = target[1].replace(/^<|>$/g, ''), title = target[2] ?? target[3];
        flush();
        if (picture) {
          const source = context.image(address), fallback = externalLink(address);
          if (source) out += `<img src="${escape(source)}" alt="${escape(label)}"${title ? ` title="${escape(title)}"` : ''} loading="lazy" decoding="async">`;
          else if (fallback) out += `<a href="${escape(fallback)}" target="_blank" rel="noopener noreferrer">${escape(label || fallback)}</a>`;
          else out += escape(label);
        } else {
          const body = depth < MAX_DEPTH ? inline(label, context, depth + 1, true) : escape(label), href = context.link(address);
          out += !href ? body : `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}${/^(https?:|mailto:)/.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${body}</a>`;
        }
        i = end + target[0].length; continue;
      }
    }
    if (character === '<') {
      const match = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(text.slice(i)), href = match && externalLink(match[1]);
      if (href && !linked) { flush(); out += `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(match[1].replace(/^mailto:/, ''))}</a>`; i += match[0].length; continue; }
    }
    if (character === 'h' && !linked && !/[\p{L}\p{N}]/u.test(plain.at(-1) || '')) {
      const match = /^https?:\/\/[!-;=?-~]+/.exec(text.slice(i)), address = match?.[0].replace(/[.,;:!?'")\]*_~]+$/, ''), href = address && externalLink(address);
      if (href) { flush(); out += `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(address)}</a>`; i += address.length; continue; }
    }
    if ('*_~'.includes(character) && depth < MAX_DEPTH) {
      const mark = next === character ? character + character : character === '~' ? '' : character, after = text[i + mark.length];
      const opens = mark && after && !/\s/.test(after) && !(character === '_' && /[\p{L}\p{N}]/u.test(plain.at(-1) || ''));
      const end = opens ? closing(text, mark, i + mark.length) : -1;
      if (end > i + mark.length) {
        const tag = mark.length === 1 ? 'em' : character === '~' ? 'del' : 'strong';
        flush(); out += `<${tag}>${inline(text.slice(i + mark.length, end), context, depth + 1, linked)}</${tag}>`; i = end + mark.length; continue;
      }
      if (mark.length > 1) { plain += mark; i += mark.length; continue; }
    }
    plain += character; i++;
  }
  flush();
  return out;
}

function blocks(lines, context, depth, tight = false) {
  const out = []; let i = 0;
  const starts = index => { const line = lines[index]; return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line); };
  while (i < lines.length) {
    const line = lines[i]; let match;
    if (!line.trim()) { i++; continue; }
    if ((match = FENCE.exec(line))) {
      const code = []; i++;
      while (i < lines.length && !(lines[i].trim().startsWith(match[1]) && /^ {0,3}([`~])\1*[ \t]*$/.test(lines[i]))) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${match[2] ? ` data-lang="${escape(match[2])}"` : ''}>${escape(code.join('\n'))}\n</code></pre>`); continue;
    }
    if ((match = HEADING.exec(line))) {
      // The post title is the page's h1, so headings in the text start one level down.
      const level = Math.min(6, match[1].length + 1);
      out.push(`<h${level}>${inline(match[2], context)}</h${level}>`); i++; continue;
    }
    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !starts(i))) inner.push(lines[i++].replace(QUOTE, ''));
      out.push(`<blockquote>${depth < MAX_DEPTH ? blocks(inner, context, depth + 1) : `<p>${escape(inner.join('\n'))}</p>`}</blockquote>`); continue;
    }
    if ((match = ITEM.exec(line))) {
      const ordered = /\d/.test(match[2]), items = []; let loose = false;
      while (i < lines.length) {
        const head = ITEM.exec(lines[i]);
        if (!head || head[1].length !== match[1].length || /\d/.test(head[2]) !== ordered || RULE.test(lines[i])) break;
        const indent = head[1].length + head[2].length + Math.min(head[3].length || 1, 4), item = [lines[i].slice(head[0].length)]; i++;
        while (i < lines.length) {
          if (!lines[i].trim()) {
            let ahead = i; while (ahead < lines.length && !lines[ahead].trim()) ahead++;
            const follows = ahead < lines.length && lines[ahead].search(/\S/) >= Math.min(indent, 2 + head[1].length);
            const sibling = ahead < lines.length && ITEM.exec(lines[ahead])?.[1].length === head[1].length;
            if (!follows && !sibling) break;
            loose = true; if (!follows) { i = ahead; break; }
            item.push(''); i++; continue;
          }
          const space = lines[i].search(/\S/);
          if (space <= head[1].length && starts(i)) break;
          item.push(lines[i].slice(Math.min(space, indent))); i++;
        }
        items.push(item);
      }
      const first = ordered ? Number.parseInt(match[2], 10) : 1;
      out.push(`<${ordered ? `ol${first !== 1 ? ` start="${first}"` : ''}` : 'ul'}>${items.map(item => {
        const task = /^\[([ xX])\][ \t]+/.exec(item[0]); if (task) item[0] = item[0].slice(task[0].length);
        const body = depth < MAX_DEPTH ? blocks(item, context, depth + 1, !loose) : escape(item.join('\n'));
        return `<li${task ? ' class="task"' : ''}>${task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ` : ''}${body}</li>`;
      }).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && DIVIDER.test(lines[i + 1]) && cells(line).length === cells(lines[i + 1]).length) {
      const head = cells(line), align = cells(lines[i + 1]).map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : ''); i += 2;
      const cell = (tag, value, column) => `<${tag}${align[column] ? ` data-align="${align[column]}"` : ''}>${inline(value || '', context)}</${tag}>`;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((value, column) => cell('th', value, column)).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${head.map((_, column) => cell('td', row[column], column)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const paragraph = [line.replace(/^ {1,3}/, '')]; i++;
    while (i < lines.length && lines[i].trim() && !starts(i)) paragraph.push(lines[i++].replace(/^[ \t]+/, ''));
    const body = inline(paragraph.join('\n').replace(/[ \t]+$/, ''), context);
    out.push(tight ? body : `<p>${body}</p>`);
  }
  return out.join('\n');
}

export function renderMarkdown(source, { image = () => '', link = externalLink } = {}) {
  return blocks(String(source).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\0/g, '').split('\n'), { image, link }, 0);
}

// The words of a passage without its markup, for summaries and reading time.
export function plainText(source) {
  return renderMarkdown(source).replace(/<pre>[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]).replace(/\s+/g, ' ').trim();
}
