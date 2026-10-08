import { field, fields } from '../../web/ui.js';
import { validate } from './definition.js';
export { validate } from './definition.js';
export function edit({ data, change }) { return fields(field('标题', data.title, title => change({ title }), { maxLength: 100 })); }
export function mount(context) {
  const card = document.createElement('article'); card.className = 'todo-module';
  card.innerHTML = '<h2></h2><ul></ul><form><label class="sr-only">新事项</label><input name="task" aria-label="新事项" maxlength="200" required placeholder="下一件想做的事"><button type="submit">添加</button></form><p role="status" class="todo-status"></p>';
  context.root.append(card);
  const form = card.querySelector('form'), input = card.querySelector('input'), status = card.querySelector('[role="status"]');
  let data, saving = false;
  const rows = new Map();
  function render() {
    card.querySelector('h2').textContent = data.title;
    for (const [id, row] of rows) if (!data.items.some(item => item.id === id)) { row.remove(); rows.delete(id); }
    data.items.forEach((item, index) => {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement('li');
        const label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('span');
        check.type = 'checkbox'; label.append(check, name); row.append(label);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; row.append(remove);
        check.addEventListener('change', () => persist({ ...data, items: data.items.map(value => value.id === item.id ? { ...value, done: check.checked } : value) }), { signal: context.signal });
        remove.addEventListener('click', () => persist({ ...data, items: data.items.filter(value => value.id !== item.id) }), { signal: context.signal });
        rows.set(item.id, row);
      }
      row.querySelector('input').checked = item.done;
      row.querySelector('input').disabled = !context.writable || saving;
      row.querySelector('span').textContent = item.text;
      row.classList.toggle('done', item.done);
      const remove = row.querySelector('button'); remove.disabled = !context.writable || saving; remove.hidden = !context.writable; remove.setAttribute('aria-label', `移除 ${item.text}`);
      const list = card.querySelector('ul'); if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    form.hidden = !context.writable;
    input.disabled = saving; form.querySelector('button').disabled = saving || data.items.length >= 100;
  }
  async function persist(next, added = false) {
    if (saving || !context.writable) return;
    saving = true; render(); status.textContent = '保存中…';
    try {
      data = await context.save(validate(next));
      if (added) input.value = '';
      status.textContent = '已更新草稿';
    } catch (error) { status.textContent = error.message; }
    finally { saving = false; if (!context.signal.aborted) render(); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim();
    if (value) persist({ ...data, items: [...data.items, { id: crypto.randomUUID(), text: value, done: false }] }, true);
  }, { signal: context.signal });
  return { update(next) { data = next; render(); } };
}
