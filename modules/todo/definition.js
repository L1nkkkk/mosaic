import { text } from '../../web/ui.js';
import { validDate } from './items.js';
export const meta = {
  id: 'todo', name: '待办清单', version: 2, description: '一本便签：写下事项，划掉、拖动排序，可带截止日期或每天重来。',
  layout: { span: 6, minWidth: 260 }, defaultData: { title: '接下来', items: [{ id: 'first', text: '试着完成一件小事', done: false }] },
};
// `due`, `daily` and `doneAt` are kept only when set, so lists written before they existed stay as they are.
export function validate(data = {}) {
  if (!data || !Array.isArray(data.items) || data.items.length > 100) throw new Error('待办最多 100 条。');
  const seen = new Set();
  const items = data.items.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id) || typeof item.done !== 'boolean') throw new Error('待办格式无效。');
    seen.add(item.id);
    const value = text(item.text, 200, '事项');
    if (!value) throw new Error('事项不能为空。');
    if (item.daily !== undefined && typeof item.daily !== 'boolean') throw new Error('待办格式无效。');
    for (const key of ['due', 'doneAt']) if (item[key] !== undefined && item[key] !== '' && !validDate(item[key])) throw new Error('日期格式无效。');
    const result = { id: item.id, text: value, done: item.done };
    // A daily task is due every day, so it carries no date of its own.
    if (item.daily) result.daily = true; else if (item.due) result.due = item.due;
    if (item.done && item.doneAt) result.doneAt = item.doneAt;
    return result;
  });
  return { title: text(data.title, 100, '标题'), items };
}
