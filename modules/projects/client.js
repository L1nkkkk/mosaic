import { escape, field, fields } from '../../web/ui.js';
import { validate, publicData, STAGES, ACCENTS } from './definition.js';
export { validate } from './definition.js';

const PRIVATE_MARK = /\s*(#私|🔒)\s*$/u;
const toLines = milestones => milestones.map(item => `[${item.done ? 'x' : ' '}] ${item.text}${item.private ? ' #私' : ''}`).join('\n');
function fromLines(value) {
  return value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 24).map(line => {
    const hidden = PRIVATE_MARK.test(line), body = line.replace(PRIVATE_MARK, ''), mark = body.match(/^\[([ xX]?)\]\s*/);
    return { text: (mark ? body.slice(mark[0].length) : body).slice(0, 120), done: Boolean(mark && mark[1].toLowerCase() === 'x'), ...(hidden ? { private: true } : {}) };
  }).filter(item => item.text);
}

function choice(label, value, options, change) {
  const wrapper = document.createElement('label'); wrapper.className = 'field';
  const caption = document.createElement('span'); caption.textContent = label;
  const select = document.createElement('select'); select.setAttribute('aria-label', label);
  for (const [id, name] of options) select.add(new Option(name, id));
  select.value = value; select.onchange = () => change(select.value);
  wrapper.append(caption, select); return wrapper;
}

export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const update = (patch, refresh) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
  data.projects.forEach((project, index) => {
    const patch = (value, refresh) => update({ projects: data.projects.map((entry, i) => i === index ? { ...entry, ...value } : entry) }, refresh);
    const row = fields(
      field(`项目 ${index + 1} · 名称`, project.name, name => patch({ name }), { maxLength: 60 }),
      field('简介', project.summary, summary => patch({ summary }), { maxLength: 200 }),
      field('链接（可选）', project.url, url => patch({ url }), { maxLength: 1500, placeholder: 'https://' }),
      choice('阶段', project.stage, STAGES, stage => patch({ stage })),
      choice('颜色', project.accent, ACCENTS, accent => patch({ accent })),
      field('里程碑 · 每行一条，[x] 表示完成，行尾加 #私 表示不公开', toLines(project.milestones), value => patch({ milestones: fromLines(value) }), { multiline: true, maxLength: 4000 }),
      field('内部备注 · 不公开', project.note, note => patch({ note }), { multiline: true, maxLength: 1000 }),
    );
    row.classList.add('link-editor');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这个项目';
    remove.onclick = () => update({ projects: data.projects.filter((_, i) => i !== index) }, true);
    row.append(remove); wrapper.append(row);
  });
  if (data.projects.length < 8) {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加项目';
    add.onclick = () => update({ projects: [...data.projects, { id: crypto.randomUUID(), name: '新的项目', summary: '', url: '', stage: 'idea', accent: ACCENTS[data.projects.length % ACCENTS.length][0], paused: false, note: '', milestones: [] }] }, true);
    wrapper.append(add);
  }
  return wrapper;
}

export function mount(context) {
  const card = document.createElement('article'); card.className = 'projects-module'; card.dataset.ownBackground = '';
  card.innerHTML = '<header><h2></h2><span class="pj-total"></span></header><div class="pj-list"></div><p role="status" class="pj-status"></p>';
  context.root.append(card);
  const list = card.querySelector('.pj-list'), status = card.querySelector('.pj-status');
  let data, saving = false, opened;

  function project(item, writable) {
    const progress = item.progress || { done: item.milestones.filter(entry => entry.done).length, total: item.milestones.length };
    const stage = STAGES.findIndex(([id]) => id === item.stage), complete = item.stage === 'shipped' && !item.paused;
    const element = document.createElement('details'); element.className = 'pj'; element.dataset.id = item.id; element.dataset.accent = item.accent;
    element.classList.toggle('is-paused', item.paused); element.classList.toggle('is-shipped', complete);
    element.open = opened.has(item.id);
    const segments = Math.max(progress.total, 1);
    element.innerHTML = `<summary><span class="pj-name">${escape(item.name)}</span><span class="pj-stage">${item.paused ? '暂停' : STAGES[stage][1]}</span><span class="pj-count">${progress.total ? `${progress.done}<i>/</i>${progress.total}` : '—'}</span><span class="pj-track" role="img" aria-label="${progress.total ? `已完成 ${progress.done} / ${progress.total} 个里程碑` : '还没有里程碑'}">${Array.from({ length: segments }, (_, index) => `<i${index < progress.done ? ' class="on"' : ''}></i>`).join('')}</span></summary>
      <div class="pj-body">${item.summary ? `<p class="pj-summary">${escape(item.summary)}</p>` : ''}
      <ol class="pj-pipeline" aria-label="阶段">${STAGES.map(([id, name], index) => `<li class="${index < stage ? 'past' : index === stage ? 'now' : ''}">${writable ? `<button type="button" data-stage="${id}" aria-pressed="${index === stage}">${name}</button>` : `<span>${name}</span>`}</li>`).join('')}${writable ? `<li class="pj-pause"><button type="button" data-pause aria-pressed="${item.paused}">暂停</button></li>` : ''}</ol>
      ${item.milestones.length ? `<ul class="pj-miles">${item.milestones.map((entry, index) => `<li class="${entry.done ? 'done' : ''}${entry.private ? ' hidden-mile' : ''}">${writable ? `<label><input type="checkbox" data-mile="${index}"${entry.done ? ' checked' : ''}><span>${escape(entry.text)}</span></label><button type="button" data-lock="${index}" aria-pressed="${Boolean(entry.private)}" aria-label="${entry.private ? '改为公开' : '改为不公开'}：${escape(entry.text)}" title="${entry.private ? '不公开' : '公开'}">${entry.private ? '不公开' : '公开'}</button>` : `<span>${escape(entry.text)}</span>`}</li>`).join('')}</ul>` : ''}
      ${writable ? `<form class="pj-add"><input name="mile" aria-label="${escape(item.name)} 的新里程碑" maxlength="120" placeholder="下一个里程碑" required><button type="submit">添加</button></form><label class="pj-note"><span>内部备注 · 不公开</span><textarea rows="2" maxlength="1000">${escape(item.note)}</textarea></label>` : ''}
      ${item.url ? `<a class="pj-link" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">打开项目<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : ''}</div>`;
    return element;
  }

  function render() {
    const writable = context.writable;
    // Read-only views show exactly what visitors would receive.
    const shown = writable || context.view === 'public' ? data : publicData(data);
    if (!opened) opened = new Set(shown.projects.slice(0, 1).map(item => item.id));
    else for (const element of list.children) { if (element.open) opened.add(element.dataset.id); else opened.delete(element.dataset.id); }
    card.querySelector('h2').textContent = shown.title;
    card.querySelector('.pj-total').textContent = shown.projects.length ? `${shown.projects.filter(item => item.stage === 'shipped').length} / ${shown.projects.length} 已发布` : '';
    list.replaceChildren(...shown.projects.map(item => project(item, writable)));
    if (!shown.projects.length) list.innerHTML = '<p class="pj-empty">还没有项目，在编辑台添加第一个。</p>';
    card.classList.toggle('is-saving', saving);
    for (const control of list.querySelectorAll('button,input,textarea')) control.disabled = saving;
  }

  async function persist(id, change, focus) {
    if (saving || !context.writable) return;
    for (const element of list.children) { if (element.open) opened.add(element.dataset.id); else opened.delete(element.dataset.id); }
    saving = true; status.textContent = '保存中…';
    card.classList.add('is-saving');
    try {
      data = await context.save(validate({ ...data, projects: data.projects.map(item => item.id === id ? change(structuredClone(item)) : item) }));
      status.textContent = '已保存';
    } catch (error) { status.textContent = error.message; }
    finally {
      saving = false;
      if (!context.signal.aborted) { render(); if (focus) list.querySelector(`[data-id="${CSS.escape(id)}"] ${focus}`)?.focus({ preventScroll: true }); }
    }
  }

  const idOf = target => target.closest('.pj')?.dataset.id;
  list.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    const id = idOf(button);
    if (button.dataset.stage) persist(id, item => ({ ...item, stage: button.dataset.stage, paused: false }));
    else if ('pause' in button.dataset) persist(id, item => ({ ...item, paused: !item.paused }));
    else if (button.dataset.lock) persist(id, item => { const entry = item.milestones[Number(button.dataset.lock)]; if (entry.private) delete entry.private; else entry.private = true; return item; });
  }, { signal: context.signal });
  list.addEventListener('change', event => {
    const target = event.target, id = idOf(target);
    if (target.dataset.mile) persist(id, item => { item.milestones[Number(target.dataset.mile)].done = target.checked; return item; });
    else if (target.matches('.pj-note textarea')) persist(id, item => ({ ...item, note: target.value }));
  }, { signal: context.signal });
  list.addEventListener('submit', event => {
    event.preventDefault();
    const value = event.target.elements.mile.value.trim(), id = idOf(event.target);
    if (!value) return;
    if (data.projects.find(item => item.id === id).milestones.length >= 24) { status.textContent = '每个项目最多 24 个里程碑。'; return; }
    persist(id, item => ({ ...item, milestones: [...item.milestones, { text: value, done: false }] }), '.pj-add input');
  }, { signal: context.signal });
  // One project open at a time keeps the card a steady height.
  list.addEventListener('toggle', event => {
    if (!event.target.open) return;
    for (const element of list.children) if (element !== event.target && element.open && !element.contains(document.activeElement)) element.open = false;
  }, { capture: true, signal: context.signal });

  return { update(next) { data = next; render(); } };
}
