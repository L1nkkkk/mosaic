// Shared by the definition and the client: dates and list rules only, no DOM.
const DAY = 86400000, WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const stamp = date => { const [year, month, day] = date.split('-').map(Number); return Date.UTC(year, month - 1, day); };

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = stamp(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// The reader's own calendar day; a task ticked late at night is done on that day.
export function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// A daily task ticked on an earlier day is open again.
export const isDone = (item, day) => item.done && (!item.daily || item.doneAt === day);
export const doneToday = (items, day) => items.filter(item => item.done && item.doneAt === day).length;

// Stored form of the list on `day`: daily tasks from earlier days lose their tick.
export function settle(items, day) {
  return items.map(item => { if (!item.done || isDone(item, day)) return item; const { doneAt, ...rest } = item; return { ...rest, done: false }; });
}

export function toggle(item, done, day) {
  const { doneAt, ...rest } = item;
  return done ? { ...rest, done: true, doneAt: day } : { ...rest, done: false };
}

// Puts the tasks named in `order` into the places those tasks already hold; the others stay where they are.
export function reorder(items, order) {
  const moved = new Set(order), byId = new Map(items.map(item => [item.id, item]));
  let next = 0;
  return items.map(item => moved.has(item.id) ? byId.get(order[next++]) : item);
}

export function dueLabel(due, day) {
  const days = Math.round((stamp(due) - stamp(day)) / DAY);
  if (days < 0) return { text: `逾期 ${-days} 天`, state: 'late' };
  if (days === 0) return { text: '今天', state: 'today' };
  if (days === 1) return { text: '明天', state: 'soon' };
  const [year, month, date] = due.split('-').map(Number);
  if (days < 7) return { text: WEEK[new Date(stamp(due)).getUTCDay()], state: 'soon' };
  return { text: `${year === Number(day.slice(0, 4)) ? '' : `${year}年`}${month}月${date}日`, state: 'later' };
}
