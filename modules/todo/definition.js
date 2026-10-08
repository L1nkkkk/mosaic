import { text } from '../../web/ui.js';
export const meta = {
  id: 'todo', name: '待办清单', version: 1, description: '直接勾选和添加事项，公开页只展示已发布内容。',
  layout: { span: 6, minWidth: 260 }, defaultData: { title: '接下来', items: [{ id: 'first', text: '试着完成一件小事', done: false }] },
};
export function validate(data = {}) {
  if (!data || !Array.isArray(data.items) || data.items.length > 100) throw new Error('待办最多 100 条。');
  const seen = new Set();
  const items = data.items.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id) || typeof item.done !== 'boolean') throw new Error('待办格式无效。');
    seen.add(item.id);
    const value = text(item.text, 200, '事项');
    if (!value) throw new Error('事项不能为空。');
    return { id: item.id, text: value, done: item.done };
  });
  return { title: text(data.title, 100, '标题'), items };
}
