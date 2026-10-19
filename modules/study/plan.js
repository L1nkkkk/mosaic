// Shared by the definition, the client and the tests: levels and the paste importer, no DOM.
export const LEVELS = ['没碰过', 'AI 写的', '做过一部分', '自己实现过', '能讲透'];
export const MASTERED = 3;
const clean = value => value.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const cells = line => line.includes('\t') ? line.split('\t').map(clean) : line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(clean);
const separator = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const tabular = line => /^\s*\|.*\|/.test(line) || line.split('\t').length >= 2;

// What a status cell says, read the way such tables are usually written. Only marks count, so a header like "你自己实现过" is not a status.
export function readStatus(cell) {
  const star = /🎯|要做/u.test(cell);
  const level = /能讲透/.test(cell) ? 4 : /[✅✔☑]/u.test(cell) ? 3 : /^部分/.test(cell) ? 2 : /⚠|^AI/iu.test(cell) ? 1 : 0;
  const known = star || /[✅✔☑❌✗✘⚠]|^(部分|AI|能讲透)|^[—–-]$/iu.test(cell);
  // The mark itself is shown as the level, so only what the cell adds to it is kept.
  const note = clean(cell.replace(/[✅✔☑❌✗✘⚠🎯️]/gu, '')).replace(/^([—–-]|要做|部分|能讲透|AI ?写的)\s*/i, '').replace(/^[（(](.*)[）)]$/, '$1');
  return { level, star, note, known };
}

// A table becomes topics (name, status, what is left); a numbered or bulleted list becomes the reading, in order.
export function parsePlan(input) {
  const lines = String(input ?? '').replace(/\r/g, '').split('\n'), topics = [], resources = [];
  let inTable = false;
  lines.forEach((line, index) => {
    if (separator(line)) return;
    if (!tabular(line)) {
      inTable = false;
      const item = line.match(/^\s*(?:\d+[.)、]|[-*•])\s+(.+)$/);
      if (!item) return;
      const url = item[1].match(/https?:\/\/[^\s)）>]+/)?.[0] || '', plain = item[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(url, '');
      const bold = plain.match(/^\s*\*\*(.+?)\*\*\s*[：:，,]?\s*(.*)$/), split = plain.match(/^(.+?)[：:]\s*(.*)$/);
      const [title, note] = bold ? [bold[1], bold[2]] : split ? [split[1], split[2]] : [plain, ''];
      resources.push({ title: clean(title), note: clean(note).replace(/[；;。，,]$/, ''), url });
      return;
    }
    const row = cells(line); while (row.length && !row.at(-1)) row.pop();
    // The first row of a table is its header when a separator follows it or its status column holds no mark.
    const first = !inTable; inTable = true;
    if (row.length < 2 || first && (separator(lines[index + 1] ?? '') || !readStatus(row[1]).known)) return;
    const status = readStatus(row[1]);
    topics.push({ name: row[0], level: status.level, star: status.star, note: status.note, gap: row.slice(2).filter(Boolean).join('；') });
  });
  return { topics: topics.filter(topic => topic.name), resources: resources.filter(resource => resource.title) };
}

// Imported entries join the plan; one already there by the same name keeps its progress and only fills in what it lacked.
export function mergePlan(data, imported, makeId) {
  const key = value => value.toLowerCase().replace(/\s+/g, '');
  const topics = [...data.topics], resources = [...data.resources];
  for (const topic of imported.topics) {
    const found = topics.findIndex(entry => key(entry.name) === key(topic.name));
    if (found < 0) topics.push({ id: makeId(), ...topic }); else topics[found] = { ...topics[found], gap: topics[found].gap || topic.gap, note: topics[found].note || topic.note };
  }
  for (const resource of imported.resources) if (!resources.some(entry => key(entry.title) === key(resource.title))) resources.push({ id: makeId(), done: false, ...resource });
  return { ...data, topics: topics.slice(0, 60), resources: resources.slice(0, 30) };
}
