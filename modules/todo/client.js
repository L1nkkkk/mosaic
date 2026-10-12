import { field, fields } from '../../web/ui.js';
import { validate } from './definition.js';
import { today, isDone, doneToday, settle, toggle, reorder, dueLabel } from './items.js';
export { validate } from './definition.js';
export function edit({ data, change }) { return fields(field('标题', data.title, title => change({ title }), { maxLength: 100 })); }
const button = (className, label) => { const element = document.createElement('button'); element.type = 'button'; element.className = className; element.textContent = label; return element; };
// The native picker does the calendar; the field itself stays out of sight.
function pickDate(input) { try { input.showPicker(); } catch { input.focus(); } }
export function mount(context) {
  const card = document.createElement('article'); card.className = 'todo-module'; card.dataset.ownBackground = '';
  card.innerHTML = '<header class="todo-head"><h2></h2><span class="todo-tally"></span></header><ul class="todo-list"></ul><p class="todo-empty"></p>'
    + '<form class="todo-add"><input name="task" aria-label="新事项" maxlength="200" required placeholder="下一件想做的事"><button type="button" class="todo-due">日期</button><button type="button" class="todo-repeat" aria-pressed="false" title="每天重新出现">每日</button><input type="date" class="todo-picker" tabindex="-1" aria-hidden="true"><button type="submit" class="todo-submit">记下</button></form>'
    + '<details class="todo-archive"><summary></summary><ul class="todo-done"></ul><button type="button" class="todo-clear">清空已完成</button></details><p role="status" class="todo-status"></p>';
  context.root.append(card);
  const form = card.querySelector('form'), input = form.querySelector('input'), status = card.querySelector('[role="status"]');
  const list = card.querySelector('.todo-list'), archive = card.querySelector('.todo-archive'), doneList = card.querySelector('.todo-done');
  const draftDue = form.querySelector('.todo-due'), draftRepeat = form.querySelector('.todo-repeat'), draftPicker = form.querySelector('.todo-picker');
  let data, pending = null, saving = false, sorting = false, draft = { due: '', daily: false }, midnight;
  // A task just ticked stays on its line while the stroke is drawn, then moves down to the finished ones.
  const lingering = new Map(), rows = new Map();
  const current = () => settle(data.items, today());
  const patch = (id, change) => persist({ ...data, items: current().map(item => item.id === id ? change(item) : item) });
  function row(item) {
    const element = document.createElement('li'), label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('span');
    const grip = button('todo-grip', ''), due = button('todo-due', ''), repeat = button('todo-repeat', '每日'), tools = document.createElement('span'), picker = document.createElement('input');
    const addDue = button('todo-due', '日期'), addRepeat = button('todo-repeat', '每日'), remove = button('todo-remove', '×');
    check.type = 'checkbox'; name.className = 'todo-text'; label.append(check, name);
    picker.type = 'date'; picker.className = 'todo-picker'; picker.tabIndex = -1; picker.setAttribute('aria-hidden', 'true');
    repeat.title = '不再每天重复'; addRepeat.title = '每天重新出现'; tools.className = 'todo-tools'; tools.append(addDue, addRepeat, remove);
    element.append(grip, label, due, repeat, tools, picker);
    const { signal } = context, id = item.id;
    check.addEventListener('change', () => {
      const done = check.checked;
      clearTimeout(lingering.get(id)); lingering.delete(id);
      if (done && !context.reducedMotion) lingering.set(id, 0);
      patch(id, value => toggle(value, done, today())).then(saved => {
        if (!lingering.has(id)) return;
        if (saved) lingering.set(id, setTimeout(() => { lingering.delete(id); if (!signal.aborted) render(); }, 650)); else lingering.delete(id);
      });
    }, { signal });
    for (const control of [due, addDue]) control.addEventListener('click', () => pickDate(picker), { signal });
    picker.addEventListener('change', () => patch(id, ({ due: old, ...value }) => picker.value ? { ...value, due: picker.value } : value), { signal });
    repeat.addEventListener('click', () => patch(id, ({ daily, ...value }) => value), { signal });
    addRepeat.addEventListener('click', () => patch(id, value => ({ ...value, daily: true })), { signal });
    remove.addEventListener('click', () => persist({ ...data, items: current().filter(value => value.id !== id) }), { signal });
    grip.addEventListener('pointerdown', event => drag(event, element, grip), { signal });
    grip.addEventListener('keydown', event => {
      const step = { ArrowUp: -1, ArrowDown: 1 }[event.key], order = [...list.children].map(value => value.dataset.id), from = order.indexOf(id);
      if (!step || from < 0 || !order[from + step]) return;
      event.preventDefault(); order.splice(from + step, 0, ...order.splice(from, 1));
      persist({ ...data, items: reorder(current(), order) });
    }, { signal });
    element.dataset.id = id;
    return element;
  }
  // Only transforms move while dragging; the rows are measured once, when the drag starts.
  function drag(event, element, grip) {
    const siblings = [...list.children], from = siblings.indexOf(element);
    if (event.button || saving || sorting || !context.writable || from < 0 || siblings.length < 2) return;
    event.preventDefault();
    const boxes = siblings.map(value => value.getBoundingClientRect()), height = boxes[from].height, startY = event.clientY, moves = new AbortController();
    let to = from;
    sorting = true; grip.setPointerCapture(event.pointerId); list.classList.add('is-sorting'); element.classList.add('is-dragged');
    grip.addEventListener('pointermove', move => {
      // A row gives way once the dragged row's leading edge is past its middle.
      const offset = Math.max(boxes[0].top - boxes[from].top, Math.min(boxes.at(-1).bottom - boxes[from].bottom, move.clientY - startY)), top = boxes[from].top + offset;
      to = from;
      siblings.forEach((value, index) => {
        if (index === from) return;
        const middle = boxes[index].top + boxes[index].height / 2, shift = index > from && top + height > middle ? -height : index < from && top < middle ? height : 0;
        value.style.transform = shift ? `translateY(${shift}px)` : '';
        if (shift < 0 || (shift > 0 && to === from)) to = index;
      });
      element.style.transform = `translateY(${offset}px)`;
    }, { signal: moves.signal });
    const finish = commit => {
      moves.abort(); sorting = false; list.classList.remove('is-sorting'); element.classList.remove('is-dragged');
      for (const value of siblings) value.style.transform = '';
      if (!commit || to === from || context.signal.aborted) return;
      const order = siblings.map(value => value.dataset.id); order.splice(to, 0, ...order.splice(from, 1));
      persist({ ...data, items: reorder(current(), order) });
    };
    grip.addEventListener('pointerup', () => finish(true), { signal: moves.signal });
    for (const type of ['pointercancel', 'lostpointercapture']) grip.addEventListener(type, () => finish(false), { signal: moves.signal });
    context.signal.addEventListener('abort', () => moves.abort(), { signal: moves.signal });
  }
  function render() {
    if (sorting) return;
    // While a save is on its way the page already shows what was asked for; a failed save puts it back.
    const day = today(), locked = !context.writable || saving, open = [], done = [], { title, items: all } = pending || data;
    for (const item of all) (isDone(item, day) && !lingering.has(item.id) ? done : open).push(item);
    card.querySelector('h2').textContent = title;
    for (const [id, element] of rows) if (!all.some(item => item.id === id)) { element.remove(); rows.delete(id); }
    for (const [parent, items] of [[list, open], [doneList, done]]) items.forEach((item, index) => {
      let element = rows.get(item.id);
      if (!element) rows.set(item.id, element = row(item));
      const [grip, label, due, repeat, tools, picker] = element.children, [addDue, addRepeat, remove] = tools.children, check = label.firstChild, finished = isDone(item, day);
      check.checked = finished; check.disabled = locked; label.lastChild.textContent = item.text; element.classList.toggle('done', finished);
      grip.style.visibility = !context.writable || finished ? 'hidden' : ''; grip.disabled = locked; grip.setAttribute('aria-label', `移动 ${item.text}，可用上下方向键`);
      const mark = item.due && dueLabel(item.due, day);
      due.hidden = !mark; due.textContent = mark ? mark.text : ''; due.dataset.state = mark ? mark.state : ''; due.disabled = locked; due.title = item.due || '';
      repeat.hidden = !item.daily; repeat.disabled = locked; picker.value = item.due || '';
      tools.hidden = !context.writable; addDue.hidden = Boolean(item.due || item.daily) || finished; addRepeat.hidden = Boolean(item.daily);
      for (const control of tools.children) control.disabled = locked;
      addDue.setAttribute('aria-label', `给 ${item.text} 定日期`); remove.setAttribute('aria-label', `移除 ${item.text}`);
      if (parent.children[index] !== element) parent.insertBefore(element, parent.children[index] || null);
    });
    const count = doneToday(all, day), tally = card.querySelector('.todo-tally'), empty = card.querySelector('.todo-empty');
    tally.hidden = !count; tally.textContent = `今日完成 ${count} 件`;
    empty.hidden = open.length > 0; empty.textContent = done.length ? '都划掉了。' : context.writable ? '还是一页白纸。' : '暂时没有待办。';
    archive.hidden = !done.length; archive.querySelector('summary').textContent = `已完成 ${done.length} 件`;
    // Daily tasks come back tomorrow, so clearing leaves them alone.
    const clear = card.querySelector('.todo-clear'); clear.hidden = !context.writable || !done.some(item => !item.daily); clear.disabled = locked;
    form.hidden = !context.writable;
    const mark = draft.due && dueLabel(draft.due, day);
    draftDue.textContent = mark ? mark.text : '日期'; draftDue.dataset.state = mark ? mark.state : ''; draftDue.hidden = draft.daily; draftPicker.value = draft.due;
    draftRepeat.setAttribute('aria-pressed', String(draft.daily));
    for (const control of form.elements) control.disabled = saving;
    form.querySelector('.todo-submit').disabled = saving || all.length >= 100;
    clearTimeout(midnight); const now = new Date();
    midnight = setTimeout(() => { if (!context.signal.aborted) render(); }, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now + 1000);
  }
  // Resolves to whether the save went through.
  async function persist(next, added = false) {
    if (saving || !context.writable) return false;
    const focused = card.contains(document.activeElement) ? document.activeElement : null;
    status.textContent = '保存中…';
    try {
      saving = true; pending = validate(next); render();
      data = await context.save(pending);
      if (added) { input.value = ''; draft = { due: '', daily: false }; }
      status.textContent = '已更新草稿';
      return true;
    } catch (error) { status.textContent = error.message; return false; }
    finally {
      saving = false; pending = null;
      if (!context.signal.aborted) { render(); if (focused?.isConnected && !focused.hidden && document.activeElement !== focused) focused.focus({ preventScroll: true }); }
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim();
    if (value) persist({ ...data, items: [...current(), { id: crypto.randomUUID(), text: value, done: false, ...(draft.daily ? { daily: true } : draft.due ? { due: draft.due } : {}) }] }, true);
  }, { signal: context.signal });
  draftDue.addEventListener('click', () => pickDate(draftPicker), { signal: context.signal });
  draftPicker.addEventListener('change', () => { draft.due = draftPicker.value; render(); }, { signal: context.signal });
  draftRepeat.addEventListener('click', () => { draft = { due: '', daily: !draft.daily }; render(); }, { signal: context.signal });
  card.querySelector('.todo-clear').addEventListener('click', () => { const day = today(); persist({ ...data, items: current().filter(item => item.daily || !isDone(item, day)) }); }, { signal: context.signal });
  return {
    update(next) { data = next; render(); },
    // Coming back to the page on a later day reopens the daily tasks.
    setActive(active) { if (active && data) render(); },
    dispose() { clearTimeout(midnight); for (const timer of lingering.values()) clearTimeout(timer); },
  };
}
