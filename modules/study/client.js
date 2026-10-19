import { field, fields } from '../../web/ui.js';
import { validate } from './definition.js';
import { LEVELS, MASTERED, parsePlan, mergePlan } from './plan.js';
import { todoAvailable, addTodo, openInBrowser } from '../handoff.js';
export { validate } from './definition.js';
const element = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
const button = (className, text) => { const node = element('button', className, text); node.type = 'button'; return node; };
const newId = () => crypto.randomUUID();

export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const commit = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => commit({ title }), { maxLength: 100 }));
  // Paste a table from a chat or a Markdown note; rows already on the plan keep their progress.
  const paste = element('div', 'field study-import'), box = element('textarea'), run = button('button subtle', '导入'), result = element('small', 'study-import-result');
  box.rows = 6; box.placeholder = '粘贴表格（Markdown 或从网页复制的表格）和编号的资料清单'; box.setAttribute('aria-label', '粘贴学习表');
  run.onclick = () => {
    const imported = parsePlan(box.value);
    if (!imported.topics.length && !imported.resources.length) { result.textContent = '没有认出表格行或编号清单。'; return; }
    commit(mergePlan(data, imported, newId), true);
  };
  paste.append(element('span', '', '从表格导入'), box, run, result); wrapper.append(paste);
  wrapper.append(element('h3', 'study-edit-heading', `主题（${data.topics.length}）`));
  data.topics.forEach((topic, index) => {
    const patch = next => commit({ topics: data.topics.map((entry, i) => i === index ? { ...entry, ...next } : entry) });
    const row = fields(field('主题', topic.name, name => patch({ name }), { maxLength: 80 }), field('现状说明', topic.note, note => patch({ note }), { maxLength: 120, placeholder: '例如：LearnOpenGL 阶段做过' }), field('要补的内容', topic.gap, gap => patch({ gap }), { maxLength: 300, multiline: true }));
    const level = element('label', 'field'), select = element('select');
    LEVELS.forEach((name, value) => { const option = element('option', '', name); option.value = String(value); select.append(option); });
    select.value = String(topic.level); select.onchange = () => patch({ level: Number(select.value) }); level.append(element('span', '', '掌握程度'), select); row.append(level);
    const star = element('label', 'field study-edit-star'), check = element('input'); check.type = 'checkbox'; check.checked = topic.star; check.onchange = () => patch({ star: check.checked });
    const caption = element('span'); caption.append(check, ' 重点项目，排在最前'); star.append(caption); row.append(star);
    const remove = button('text-button danger', '移除这个主题'); remove.onclick = () => commit({ topics: data.topics.filter((_, i) => i !== index) }, true); row.append(remove);
    wrapper.append(row);
  });
  if (data.topics.length < 60) { const add = button('button subtle', '＋ 添加主题'); add.onclick = () => commit({ topics: [...data.topics, { id: newId(), name: '', level: 0, star: false, note: '', gap: '' }] }, true); wrapper.append(add); }
  wrapper.append(element('h3', 'study-edit-heading', `学习顺序（${data.resources.length}）`));
  data.resources.forEach((resource, index) => {
    const patch = next => commit({ resources: data.resources.map((entry, i) => i === index ? { ...entry, ...next } : entry) });
    const row = fields(field('资料', resource.title, title => patch({ title }), { maxLength: 160 }), field('说明', resource.note, note => patch({ note }), { maxLength: 300 }), field('链接（可选）', resource.url, url => patch({ url }), { maxLength: 1500, placeholder: 'https://' }));
    const actions = element('div', 'study-edit-actions');
    const up = button('text-button', '上移'); up.disabled = index === 0; up.onclick = () => { const list = [...data.resources]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; commit({ resources: list }, true); };
    const remove = button('text-button danger', '移除'); remove.onclick = () => commit({ resources: data.resources.filter((_, i) => i !== index) }, true);
    actions.append(up, remove); row.append(actions); wrapper.append(row);
  });
  if (data.resources.length < 30) { const add = button('button subtle', '＋ 添加资料'); add.onclick = () => commit({ resources: [...data.resources, { id: newId(), title: '', note: '', url: '', done: false }] }, true); wrapper.append(add); }
  return wrapper;
}

export function mount(context) {
  const card = element('article', 'study-module'); card.dataset.ownBackground = '';
  card.innerHTML = '<header class="study-head"><h2></h2><p class="study-count"></p><div class="study-bar" aria-hidden="true"></div><button type="button" class="study-filter" aria-pressed="false">只看没过关的</button></header>'
    + '<ol class="study-topics"></ol><p class="study-empty"></p><section class="study-reading"><h3>学习顺序</h3><ol class="study-resources"></ol></section><p role="status" class="study-status"></p>';
  context.root.append(card);
  const topicList = card.querySelector('.study-topics'), resourceList = card.querySelector('.study-resources'), status = card.querySelector('[role="status"]'), filter = card.querySelector('.study-filter'), bar = card.querySelector('.study-bar');
  for (let level = 0; level < LEVELS.length; level++) bar.append(element('span', '', ''));
  let data, pending = null, saving = false, unfinished = false;
  const topicRows = new Map(), resourceRows = new Map(), { signal } = context;
  const save = next => persist({ ...data, ...next });
  const setTopic = (id, change) => save({ topics: data.topics.map(topic => topic.id === id ? { ...topic, ...change(topic) } : topic) });
  // A todo module may mount after this one, so the offer is checked again whenever the card is approached.
  const offerTodo = () => card.classList.toggle('has-todo', context.writable && todoAvailable());
  function topicRow(id) {
    const row = element('li', 'study-topic'), star = button('study-star', '★'), name = element('div', 'study-name'), meter = element('div', 'study-meter'), level = element('span', 'study-level'), gap = element('p', 'study-gap'), todo = button('study-todo', '→ 待办');
    name.append(element('strong'), element('small'));
    meter.setAttribute('role', 'group');
    // Four cells for the four levels above "not touched"; pressing the top filled cell steps back one.
    for (let value = 1; value < LEVELS.length; value++) {
      const cell = button('study-cell', ''); cell.dataset.value = String(value); cell.title = LEVELS[value];
      cell.addEventListener('click', () => setTopic(id, topic => ({ level: topic.level === value ? value - 1 : value })), { signal });
      meter.append(cell);
    }
    star.addEventListener('click', () => setTopic(id, topic => ({ star: !topic.star })), { signal });
    todo.addEventListener('click', () => {
      const topic = data.topics.find(entry => entry.id === id);
      if (!topic) return;
      const task = (topic.gap ? `${topic.name}：${topic.gap}` : topic.name).slice(0, 200);
      if (!addTodo(task)) { status.textContent = '待办正在保存，稍后再试。'; offerTodo(); return; }
      todo.textContent = '已加入 ✓'; todo.classList.add('is-sent'); status.textContent = '已加入待办';
      setTimeout(() => { todo.textContent = '→ 待办'; todo.classList.remove('is-sent'); }, 1600);
    }, { signal });
    row.append(star, name, meter, level, gap, todo); row.dataset.id = id;
    return row;
  }
  function resourceRow(id) {
    const row = element('li', 'study-resource'), label = element('label'), check = element('input'), title = element('span', 'study-resource-title'), link = element('a', 'study-link', '打开 ↗'), note = element('p', 'study-resource-note');
    check.type = 'checkbox'; label.append(check, title); link.target = '_blank'; link.rel = 'noopener noreferrer';
    check.addEventListener('change', () => save({ resources: data.resources.map(entry => entry.id === id ? { ...entry, done: check.checked } : entry) }), { signal });
    // On the private page a browser module, when there is one, opens the link in place.
    link.addEventListener('click', event => { if (openInBrowser(link.href)) event.preventDefault(); }, { signal });
    row.append(label, link, note); row.dataset.id = id;
    return row;
  }
  function place(list, rows, items, make) {
    for (const [id, row] of rows) if (!items.some(item => item.id === id)) { row.remove(); rows.delete(id); }
    return items.map((item, index) => {
      let row = rows.get(item.id);
      if (!row) rows.set(item.id, row = make(item.id));
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      return row;
    });
  }
  function render() {
    // While a save is on its way the card already shows what was asked for; a failed save puts it back.
    const { title, topics, resources } = pending || data, locked = !context.writable || saving;
    card.querySelector('h2').textContent = title; card.classList.toggle('is-readonly', !context.writable);
    const counts = LEVELS.map((_, level) => topics.filter(topic => topic.level === level).length);
    card.querySelector('.study-count').textContent = topics.length ? `能讲透 ${counts[4]} · 实现过 ${counts[3]} · 共 ${topics.length} 项` : '';
    [...bar.children].forEach((segment, level) => { segment.style.flexGrow = String(counts[level]); segment.dataset.level = String(level); });
    bar.hidden = !topics.length; filter.hidden = !topics.length; filter.setAttribute('aria-pressed', String(unfinished));
    // Starred topics come first; the filter only hides rows, it never changes the plan.
    const ordered = [...topics.filter(topic => topic.star), ...topics.filter(topic => !topic.star)];
    place(topicList, topicRows, ordered, topicRow).forEach((row, index) => {
      const topic = ordered[index], [star, name, meter, level, gap, todo] = row.children;
      row.dataset.level = String(topic.level); row.classList.toggle('is-starred', topic.star); row.hidden = unfinished && topic.level >= MASTERED;
      star.setAttribute('aria-pressed', String(topic.star)); star.setAttribute('aria-label', topic.star ? `取消重点 ${topic.name}` : `设为重点 ${topic.name}`); star.disabled = locked; star.tabIndex = context.writable ? 0 : -1;
      name.firstChild.textContent = topic.name; name.lastChild.textContent = topic.note; name.lastChild.hidden = !topic.note;
      meter.setAttribute('aria-label', `${topic.name} 的掌握程度：${LEVELS[topic.level]}`);
      for (const cell of meter.children) { const value = Number(cell.dataset.value); cell.classList.toggle('is-filled', value <= topic.level); cell.disabled = locked; cell.setAttribute('aria-pressed', String(value === topic.level)); cell.setAttribute('aria-label', LEVELS[value]); }
      level.textContent = LEVELS[topic.level]; gap.textContent = topic.gap; gap.hidden = !topic.gap; todo.hidden = !context.writable; todo.disabled = saving;
      todo.setAttribute('aria-label', `把 ${topic.name} 加入待办`);
    });
    const empty = card.querySelector('.study-empty');
    empty.hidden = topics.length > 0 && !(unfinished && topics.every(topic => topic.level >= MASTERED));
    empty.textContent = topics.length ? '全部过关了。' : '在编辑台的「从表格导入」里粘贴一张学习表开始。';
    card.querySelector('.study-reading').hidden = !resources.length;
    place(resourceList, resourceRows, resources, resourceRow).forEach((row, index) => {
      const resource = resources[index], [label, link, note] = row.children;
      label.firstChild.checked = resource.done; label.firstChild.disabled = locked; label.lastChild.textContent = resource.title; row.classList.toggle('done', resource.done);
      link.hidden = !resource.url; if (resource.url) link.href = resource.url; else link.removeAttribute('href');
      link.setAttribute('aria-label', `打开 ${resource.title}`); note.textContent = resource.note; note.hidden = !resource.note;
    });
    offerTodo();
  }
  async function persist(next) {
    if (saving || !context.writable) return;
    const focused = card.contains(document.activeElement) ? document.activeElement : null;
    status.textContent = '保存中…';
    try {
      saving = true; pending = validate(next); render();
      data = await context.save(pending);
      status.textContent = '已更新草稿';
    } catch (error) { status.textContent = error.message; }
    finally {
      saving = false; pending = null;
      if (!signal.aborted) { render(); if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true }); }
    }
  }
  filter.addEventListener('click', () => { unfinished = !unfinished; render(); }, { signal });
  card.addEventListener('pointerenter', offerTodo, { signal });
  card.addEventListener('focusin', offerTodo, { signal });
  return { update(next) { data = next; render(); }, setActive(active) { if (active && data) offerTodo(); } };
}
