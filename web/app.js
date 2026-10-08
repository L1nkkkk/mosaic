import { mountShell, pageHeader } from './shell.js';
import { createModuleHost } from './runtime.js';
import { escape, field } from './ui.js';
import { normalizeLayout, normalizeLayoutOverride, observeModuleLayout, sizeModuleFrame } from './layout.js';
let attachLayoutEditor, reorderModules;

const app = document.querySelector('#app');
const definitions = new Map();
let catalog = [];
let state;
let selected;
let dirty = false;
let busy = false;
let noticeTimer;
let resourceTimer;
let previewAudience = 'private';
let searchQuery = '';
let readerPage;
let stopLayout = () => {};
let layoutEditor;
const resources = new Map();
const mounted = new Map();
let privateState;
let saveQueue = Promise.resolve();
function disposeModules() { for (const entry of mounted.values()) entry.host.dispose(); mounted.clear(); stopLayout(); }
async function saveModule(id, data, baseData) {
  const operation = saveQueue.then(async () => {
    if (editing) {
      const item = state.draft.modules.find(item => item.id === id);
      if (!item) throw new Error('模块已移除。');
      const module = definitions.get(item.type);
      item.data = module.validate ? module.validate(data) : data;
      setDirty(); updatePreview(); renderModuleList(); if (selected === id) renderFields();
      return structuredClone(item.data);
    }
    try {
      const current = privateState.page.modules.find(item => item.id === id);
      if (!current || JSON.stringify(current.data) !== JSON.stringify(baseData)) throw Object.assign(new Error('此模块已更新，本次操作未保存，请核对最新内容后重试。'), { status: 409 });
      privateState = await api('private/module', { method: 'PUT', body: JSON.stringify({ id, data, revision: privateState.revision }) });
      renderPage(privateState.page, document.querySelector('#private-page'), 'private');
      return structuredClone(privateState.page.modules.find(item => item.id === id).data);
    } catch (error) {
      if (error.status === 409) { privateState = await api('private/page'); await ensureModules(privateState.page); renderPage(privateState.page, document.querySelector('#private-page'), 'private'); }
      throw error;
    }
  });
  saveQueue = operation.catch(() => {});
  return operation;
}
const editing = /\/edit\/?$/.test(location.pathname);
const laboratory = /\/lab\/?$/.test(location.pathname);
const privateArea = laboratory || editing || /\/private\/?$/.test(location.pathname);
const logo = '<img src="web/mark.svg" width="28" height="28" alt=""><span>Mosaic<span class="brand-cn">拼页</span></span>';

function notice(message, error = false) {
  const element = document.querySelector('#notice');
  element.textContent = message;
  element.className = error ? 'visible error' : 'visible';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { element.className = ''; }, 4500);
}

async function api(route, options = {}) {
  const response = await fetch(new URL(`api/${route}`, document.baseURI), {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || '暂时无法完成操作。'), { status: response.status });
  return value;
}

async function loadModules(privateAccess = false, pageRequest) {
  const [metadata, result] = await Promise.all([api(privateAccess ? 'admin/modules' : 'modules'), pageRequest]);
  catalog = metadata.modules;
  await ensureModules(result?.page);
  return result;
}

async function ensureModules(page) {
  const types = page && new Set(page.modules.map(item => item.type));
  await Promise.all(catalog.filter(meta => (!types || types.has(meta.id)) && !definitions.has(meta.id)).map(async meta => {
    try {
      const module = await import(new URL(meta.entry, document.baseURI));
      if (typeof module.edit !== 'function' || (typeof module.mount !== 'function' && typeof module.render !== 'function')) throw new Error('Invalid browser module contract');
      definitions.set(meta.id, { ...module, meta });
      if (meta.isolation !== 'shadow' && !document.querySelector(`link[data-module-style="${meta.id}"]`)) {
        const style = document.createElement('link');
        style.rel = 'stylesheet'; style.href = new URL(`modules/${meta.id}/style.css`, document.baseURI); style.dataset.moduleStyle = meta.id;
        document.head.append(style);
      }
    } catch { definitions.set(meta.id, null); }
  }));
}

async function refreshResources(page) {
  const requests = new Map();
  const request = route => {
    if (!requests.has(route)) requests.set(route, api(route));
    return requests.get(route);
  };
  await Promise.all(page.modules.map(async item => {
    const module = definitions.get(item.type);
    if (!module?.load) return;
    try { resources.set(item.id, { value: await module.load({ request, id: item.id, data: structuredClone(item.data) }) }); }
    catch (error) { resources.set(item.id, { error: '状态暂时无法读取' }); if (error.status === 401) throw error; }
  }));
}

function startRefresh(action) {
  clearInterval(resourceTimer);
  resourceTimer = setInterval(() => { if (!document.hidden) action().catch(error => {
    if (error.status !== 401) return;
    clearInterval(resourceTimer); resources.clear();
    if (editing) { document.querySelector('#save-status').textContent = '登录已过期，请先复制未提交的内容，再重新登录'; updatePreview(); }
    else showLogin();
  }); }, 30_000);
}

function renderPage(page, destination, audience = 'public') {
  if (!destination) return;
  stopLayout();
  destination.classList.toggle('masonry', page.flow === 'masonry');
  const slots = [];
  const visible = audience === 'private' ? page.modules : page.modules.filter(item => item.audience !== 'private' && item.visible !== false && !definitions.get(item.type)?.meta.privateOnly);
  const ids = new Set(visible.map(item => item.id));
  for (const [id, entry] of mounted) if (!ids.has(id) || entry.slot.parentElement !== destination || visible.find(item => item.id === id)?.type !== entry.type) {
    entry.host.dispose(); entry.slot.remove(); mounted.delete(id);
  }
  destination.querySelector('.empty-state')?.remove();
  if (!visible.length) destination.innerHTML = '<div class="empty-state"><p>暂无内容</p></div>';
  let position = 0;
  for (const item of visible) {
    const module = definitions.get(item.type);
    const layout = { ...normalizeLayout(module?.meta.layout), ...(item.layout?.span === undefined ? {} : { span: item.layout.span }) };
    let entry = mounted.get(item.id);
    if (!entry) {
      const slot = document.createElement('section'); slot.className = 'module-slot'; slot.dataset.moduleId = item.id;
      const frame = document.createElement('div'); frame.className = 'module-frame';
      const content = document.createElement('div'); content.className = 'module-content';
      frame.append(content); slot.append(frame); destination.append(slot);
      entry = { slot, frame, content, type: item.type }; mounted.set(item.id, entry);
    }
    const { slot, frame, content } = entry;
    // Move only changed positions; use state-preserving DOM moves where available.
    const before = destination.children[position++];
    if (before !== slot) {
      const focus = slot.contains(document.activeElement) ? document.activeElement : null;
      if (destination.moveBefore) destination.moveBefore(slot, before || null);
      else destination.insertBefore(slot, before || null);
      focus?.focus({ preventScroll: true });
    }
    const searchable = `${module?.meta.name || ''} ${JSON.stringify(item.data)}`.toLocaleLowerCase();
    slot.hidden = !editing && Boolean(searchQuery) && !searchable.includes(searchQuery.toLocaleLowerCase());
    sizeModuleFrame(frame, layout, item.layout?.height);
    slot.dataset.appearance = item.appearance || 'card';
    slot.classList.toggle('editable-module', editing);
    slot.classList.toggle('selected', editing && selected === item.id);
    const fixed = layout.aspectRatio !== undefined || item.layout?.height !== undefined;
    if (fixed) { content.tabIndex = 0; content.setAttribute('role', 'region'); content.setAttribute('aria-label', `${module?.meta.name || '模块'}内容`); }
    else { content.removeAttribute('tabindex'); content.removeAttribute('role'); content.removeAttribute('aria-label'); }
    if (editing) {
      let bar = slot.querySelector('.module-editbar');
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'module-editbar';
        bar.innerHTML = `<button type="button" class="layout-drag" data-layout-action="move" data-label="${escape(module?.meta.name || '模块')}" aria-label="拖动排序 ${escape(module?.meta.name || '模块')}" aria-describedby="layout-help"><span aria-hidden="true">⠿</span><span>${escape(module?.meta.name || '模块')}</span></button><span class="layout-size"></span>`;
        slot.prepend(bar);
        const resize = document.createElement('button'); resize.type = 'button'; resize.className = 'layout-resize'; resize.dataset.layoutAction = 'resize';
        resize.setAttribute('aria-label', `调整${module?.meta.name || '模块'}大小`); resize.setAttribute('aria-describedby', 'layout-help'); resize.innerHTML = '<span aria-hidden="true">↘</span>'; frame.append(resize);
      }
      bar.querySelector('.layout-size').textContent = `${layout.span}/12 · ${item.layout?.height === undefined ? '自动高度' : item.layout.height + 'px'}`;
      let badge = slot.querySelector('.module-caption');
      if (audience === 'private') {
        if (!badge) { badge = document.createElement('div'); badge.className = 'module-caption'; slot.insertBefore(badge, frame); }
        badge.innerHTML = `<span class="audience-badge ${item.audience === 'private' ? 'private' : 'public'}">${item.audience === 'private' ? '仅自己' : '公开'}</span>${item.audience !== 'private' && item.visible === false ? '<span class="hidden-caption">已隐藏</span>' : ''}`;
      } else badge?.remove();
    }
    const options = { id: item.id, appearance: item.appearance, data: item.data, resource: resources.get(item.id), writable: audience === 'private', request: route => api(route), save: data => saveModule(item.id, data, item.data) };
    if (!entry.host) entry.host = createModuleHost(content, module || {}, options);
    else entry.host.update(options);
    if (!slot.hidden) slots.push({ element: slot, content, layout });
  }
  stopLayout = observeModuleLayout(destination, slots);
  const status = document.querySelector('#search-status');
  if (status) status.textContent = searchQuery ? `找到 ${slots.length} 个模块` : '';
  destination.classList.toggle('no-search-results', Boolean(searchQuery) && !slots.length);
}

function footer() {
  return '<footer class="site-footer"><span>Mosaic · 由你拼成</span><span>Small pieces. A world of your own.</span></footer>';
}

function bindSearch(audience) {
  searchQuery = '';
  const button = document.querySelector('#toggle-search'), box = document.querySelector('.dashboard-search'), input = document.querySelector('#module-search');
  const update = () => { searchQuery = input.value.trim(); renderPage(audience === 'private' ? privateState.page : readerPage, document.querySelector(`#${audience}-page`), audience); };
  button.onclick = () => {
    box.hidden = !box.hidden; button.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) input.focus(); else { input.value = ''; update(); }
  };
  input.oninput = update;
  input.onkeydown = event => { if (event.key === 'Escape') { input.value = ''; update(); box.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); } };
}

async function showPublic() {
  const { page } = await loadModules(false, api('page'));
  document.title = page.title;
  app.innerHTML = `<div class="public-shell">${pageHeader({ title: page.title })}<main id="main"><div class="page-grid" id="public-page"></div></main>${footer()}</div>`;
  mountShell(app, 'public'); readerPage = page; bindSearch('public');
  renderPage(page, document.querySelector('#public-page'));
  await refreshResources(page);
  renderPage(page, document.querySelector('#public-page'));
  startRefresh(async () => { await refreshResources(page); renderPage(page, document.querySelector('#public-page')); });
}

function showLogin() {
  clearInterval(resourceTimer);
  layoutEditor?.destroy(); layoutEditor = undefined;
  disposeModules();
  document.title = '登录 · Mosaic';
  const destination = editing ? '编辑台' : '私人空间';
  app.innerHTML = `<div class="public-shell"><header class="site-header"><a class="brand" href="./">${logo}</a><a class="text-button" href="./">返回公开页 ↗</a></header><main id="main" class="login-main"><section class="login-card"><h1>登录</h1><form id="login-form"><label class="field"><span>管理密码</span><input name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="输入管理密码"></label><p id="login-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">进入${destination} <span aria-hidden="true">→</span></button></form></section></main>${footer()}</div>`;
  mountShell(app, laboratory ? 'lab' : editing ? 'edit' : 'private');
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) });
      if (laboratory) await showLab(); else if (editing) await loadEditor(); else await showPrivate();
    } catch (error) { document.querySelector('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

async function logout() {
  if (dirty && !confirm('还有未保存的改动，确定退出吗？')) return;
  try { await api('logout', { method: 'POST', body: '{}' }); dirty = false; resources.clear(); showLogin(); } catch (error) { notice(error.message, true); }
}

async function showPrivate() {
  const first = await loadModules(true, api('private/page'));
  privateState = first;
  document.title = '私人空间 · Mosaic';
  app.innerHTML = `<div class="public-shell private-shell">${pageHeader({ privateView: true, title: first.page.title })}<main id="main"><div class="private-heading"><span>全部模块 <span class="private-scope">· 仅自己可见</span></span><div><button class="text-button" id="refresh-private">刷新状态 ↻</button><button class="text-button" id="private-logout">退出登录</button></div></div><div class="page-grid" id="private-page"></div></main>${footer()}</div>`;
  mountShell(app, 'private'); readerPage = first.page; bindSearch('private');
  document.querySelector('#private-logout').onclick = logout;
  let refreshing = false;
  const refresh = async initial => {
    if (refreshing) return;
    refreshing = true;
    try {
      const incoming = initial || await api('private/page');
      if (!privateState || incoming.revision >= privateState.revision) privateState = incoming;
      readerPage = privateState.page;
      await ensureModules(privateState.page);
      renderPage(privateState.page, document.querySelector('#private-page'), 'private');
      await refreshResources(privateState.page);
      renderPage(privateState.page, document.querySelector('#private-page'), 'private');
    } finally { refreshing = false; }
  };
  document.querySelector('#refresh-private').onclick = async () => { try { await refresh(); notice('已读取最新状态。'); } catch (error) { if (error.status === 401) showLogin(); else notice(error.message, true); } };
  await refresh(first);
  startRefresh(refresh);
}

function setDirty() { dirty = true; document.querySelector('#save-status').textContent = '有未保存的改动'; }
function updatePreview() { if (!layoutEditor?.active) renderPage(state.draft, document.querySelector('#preview-page'), previewAudience); }

function selectModule(id) {
  selected = id; renderModuleList(); renderFields();
  for (const slot of document.querySelectorAll('#preview-page>.module-slot')) slot.classList.toggle('selected', slot.dataset.moduleId === id);
}

function finishArrange(change) {
  let message = '';
  if (change?.kind === 'move') {
    const modules = reorderModules(state.draft.modules, change.id, change.targetId, change.after);
    if (modules !== state.draft.modules) {
      state.draft.modules = modules; selected = change.id; setDirty();
      message = `模块已移到第 ${modules.findIndex(item => item.id === change.id) + 1} 位。`;
    }
  } else if (change?.kind === 'resize') {
    const item = state.draft.modules.find(item => item.id === change.id);
    const layout = normalizeLayoutOverride(change.layout);
    if (item && JSON.stringify(item.layout) !== JSON.stringify(layout)) {
      if (layout) item.layout = layout; else delete item.layout;
      selected = item.id; setDirty(); message = '模块尺寸已调整，保存后生效。';
    }
  }
  renderModuleList(); renderFields(); updatePreview();
  if (message) document.querySelector('#layout-status').textContent = message;
}

function move(id, offset) {
  const list = state.draft.modules;
  const index = list.findIndex(item => item.id === id);
  if (index + offset < 0 || index + offset >= list.length) return;
  [list[index], list[index + offset]] = [list[index + offset], list[index]];
  setDirty(); renderModuleList(); updatePreview();
}

function renderModuleList() {
  const list = document.querySelector('#module-list');
  list.replaceChildren();
  document.querySelector('#module-count').textContent = String(state.draft.modules.length).padStart(2, '0');
  state.draft.modules.forEach((item, index) => {
    const meta = catalog.find(meta => meta.id === item.type);
    const row = document.createElement('div');
    row.dataset.moduleId = item.id;
    row.className = `module-row${selected === item.id ? ' selected' : ''}${item.audience !== 'private' && item.visible === false ? ' hidden-module' : ''}`;
    row.innerHTML = `<button type="button" class="module-select" aria-pressed="${selected === item.id}"><span class="module-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(meta?.name || item.type)}</strong><small>${escape((item.data.title || item.data.label || '模块内容').replaceAll('\n', ' '))}</small></span></button><div class="row-controls"><button type="button" data-action="up" title="向上移动" aria-label="向上移动 ${escape(meta?.name || '模块')}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="down" title="向下移动" aria-label="向下移动 ${escape(meta?.name || '模块')}" ${index === state.draft.modules.length - 1 ? 'disabled' : ''}>↓</button></div>`;
    const drag = document.createElement('button'); drag.type = 'button'; drag.className = 'layout-drag list-drag'; drag.dataset.layoutAction = 'move'; drag.dataset.label = meta?.name || '模块';
    drag.setAttribute('aria-label', `拖动排序 ${meta?.name || '模块'}`); drag.setAttribute('aria-describedby', 'layout-help'); drag.innerHTML = '<span aria-hidden="true">⠿</span>';
    row.prepend(drag);
    row.querySelector('.module-select').onclick = () => selectModule(item.id);
    const scope = document.createElement('span'); scope.className = `row-audience ${item.audience === 'private' ? 'private' : ''}`; scope.textContent = item.audience === 'private' ? '仅自己' : '公开';
    row.querySelector('strong').append(scope);
    row.querySelector('[data-action="up"]').onclick = () => move(item.id, -1);
    row.querySelector('[data-action="down"]').onclick = () => move(item.id, 1);
    list.append(row);
  });
}

function renderFields() {
  const container = document.querySelector('#module-fields');
  container.replaceChildren();
  const item = state.draft.modules.find(item => item.id === selected);
  if (!item) { container.innerHTML = '<p class="muted">选择一个模块，开始编辑它的内容。</p>'; return; }
  const module = definitions.get(item.type);
  const heading = document.createElement('div');
  heading.className = 'section-heading';
  heading.innerHTML = `<h3>${escape(module?.meta.name || '模块设置')}</h3>`;
  container.append(heading);
  const audienceField = document.createElement('label'); audienceField.className = 'field';
  audienceField.innerHTML = '<span>显示范围</span><select aria-label="显示范围"><option value="private">仅自己可见</option><option value="public">公开</option></select>';
  const audienceSelect = audienceField.querySelector('select'); audienceSelect.value = item.audience || 'public'; audienceSelect.disabled = Boolean(module?.meta.privateOnly);
  audienceSelect.onchange = () => { item.audience = audienceSelect.value; item.visible = item.audience === 'public'; setDirty(); renderModuleList(); renderFields(); updatePreview(); };
  container.append(audienceField);
  const scopeHelp = document.createElement('p'); scopeHelp.className = 'scope-help'; scopeHelp.textContent = module?.meta.privateOnly ? '此模块仅自己可见。' : '设为仅自己并保存，会撤下公开内容；设为公开后需再次发布。'; container.append(scopeHelp);
  const widthField = document.createElement('label'); widthField.className = 'field';
  widthField.innerHTML = '<span>模块宽度</span><select aria-label="模块宽度"><option value="">跟随模块推荐</option><option value="3">四分之一行</option><option value="4">三分之一行</option><option value="6">半行</option><option value="8">三分之二行</option><option value="12">整行</option></select>';
  const widthSelect = widthField.querySelector('select');
  if (item.layout?.span && ![3, 4, 6, 8, 12].includes(item.layout.span)) widthSelect.add(new Option(`${item.layout.span} / 12 列`, String(item.layout.span)));
  widthSelect.value = item.layout?.span ? String(item.layout.span) : '';
  widthSelect.onchange = () => {
    const layout = { ...item.layout }; if (widthSelect.value) layout.span = Number(widthSelect.value); else delete layout.span;
    finishArrange({ kind: 'resize', id: item.id, layout });
  };
  const widthHelp = document.createElement('p'); widthHelp.className = 'scope-help'; widthHelp.textContent = '空间不足时会自动加宽、换行；模块顺序保持不变。';
  container.append(widthField, widthHelp);
  const heightField = document.createElement('label'); heightField.className = 'field';
  heightField.innerHTML = '<span>模块高度</span><input type="number" min="120" max="1600" step="1" placeholder="自动，随内容或模块比例" aria-label="模块高度（像素）">';
  const heightInput = heightField.querySelector('input'); heightInput.value = item.layout?.height ?? '';
  heightInput.onchange = () => {
    if (!heightInput.checkValidity()) { heightInput.reportValidity(); return; }
    const layout = { ...item.layout }; if (heightInput.value) layout.height = Number(heightInput.value); else delete layout.height;
    finishArrange({ kind: 'resize', id: item.id, layout });
  };
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'text-button reset-layout'; reset.textContent = '恢复推荐尺寸'; reset.disabled = !item.layout;
  reset.onclick = () => finishArrange({ kind: 'resize', id: item.id });
  container.append(heightField, reset);
  const appearance = document.createElement('label'); appearance.className = 'field';
  appearance.innerHTML = '<span>外观</span><select aria-label="模块外观"><option value="card">模块默认</option><option value="bare">无边框</option></select>';
  appearance.querySelector('select').value = item.appearance || 'card';
  appearance.querySelector('select').onchange = event => { item.appearance = event.target.value; setDirty(); updatePreview(); };
  container.append(appearance);
  if (module) {
    try {
      container.append(module.edit({ data: item.data, change(next, refresh = false) {
        Object.assign(item.data, next);
        setDirty(); updatePreview();
        if (refresh) { renderFields(); renderModuleList(); }
      } }));
    } catch { container.append(document.createTextNode('这个模块暂时无法编辑，原内容已保留。')); }
  }
  const controls = document.createElement('div'); controls.className = 'module-actions';
  const visibility = document.createElement('button'); visibility.type = 'button'; visibility.className = 'text-button'; visibility.textContent = item.visible === false ? '恢复展示' : '暂时隐藏';
  visibility.onclick = () => { item.visible = item.visible === false; setDirty(); renderModuleList(); renderFields(); updatePreview(); };
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除模块';
  remove.onclick = () => { state.draft.modules = state.draft.modules.filter(entry => entry.id !== item.id); selected = state.draft.modules[0]?.id; setDirty(); renderModuleList(); renderFields(); updatePreview(); };
  if (item.audience !== 'private') controls.append(visibility);
  controls.append(remove); container.append(controls);
}

function showPalette() {
  const dialog = document.querySelector('#module-picker');
  const list = dialog.querySelector('.module-options');
  list.replaceChildren();
  for (const meta of catalog) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'module-option';
    button.innerHTML = `<strong>${escape(meta.name)} <span aria-hidden="true">＋</span></strong><p>${escape(meta.description)}</p>`;
    button.disabled = !definitions.get(meta.id) || state.draft.modules.length >= 30;
    button.onclick = () => {
      const item = { id: crypto.randomUUID(), type: meta.id, audience: 'private', visible: false, data: structuredClone(meta.defaultData) };
      state.draft.modules.push(item); selected = item.id; setDirty(); renderModuleList(); renderFields(); updatePreview(); dialog.close();
      refreshResources(state.draft).then(updatePreview).catch(() => {});
    };
    list.append(button);
  }
  dialog.showModal();
}

async function saveDraft() {
  state = await api('admin/draft', { method: 'PUT', body: JSON.stringify({ revision: state.revision, page: state.draft }) });
  dirty = false;
  document.querySelector('#save-status').textContent = '草稿已保存';
  renderModuleList(); renderFields(); updatePreview();
}

async function save(publish = false) {
  if (busy) return;
  busy = true;
  document.querySelector('.editor-layout').inert = true;
  const buttons = [document.querySelector('#save-draft'), document.querySelector('#publish')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (dirty) await saveDraft();
    if (publish) {
      state = await api('admin/publish', { method: 'POST', body: JSON.stringify({ revision: state.revision }) });
      renderModuleList(); renderFields(); updatePreview();
      document.querySelector('#save-status').textContent = '公开页已更新';
      notice('公开页已更新。');
    } else notice('已保存。');
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) document.querySelector('#save-status').textContent = '登录已过期，请重新登录；先复制尚未保存的内容';
  } finally { busy = false; document.querySelector('.editor-layout').inert = false; buttons.forEach(button => { button.disabled = false; }); }
}

async function loadEditor() {
  await loadModules(true);
  ({ attachLayoutEditor, reorderModules } = await import('./arrange.js'));
  layoutEditor?.destroy(); layoutEditor = undefined;
  state = await api('admin/state'); dirty = false; selected = state.draft.modules[0]?.id;
  previewAudience = 'private';
  await refreshResources(state.draft);
  document.title = '编辑台 · Mosaic';
  app.innerHTML = `<div class="editor-shell"><header class="editor-header"><a class="brand" href="private">${logo}</a><span class="workspace-badge">编辑台</span><span id="save-status" role="status">所有草稿已保存</span><div class="editor-toolbar"><a class="text-button" href="lab" target="_blank" rel="noopener">实验台 ↗</a><a class="text-button" href="./" target="_blank" rel="noopener">公开页 ↗</a><a class="text-button" href="private" target="_blank" rel="noopener">私人页 ↗</a><button class="button outline" id="save-draft">保存草稿</button><button class="button primary" id="publish">发布</button></div></header><main id="main" class="editor-layout"><aside class="editor-sidebar"><h1 class="sr-only">编辑页面</h1><div id="space-settings"></div><div class="section-heading"><h2>页面模块 <span id="module-count"></span></h2><button class="text-button" id="add-module">＋ 添加</button></div><div id="module-list"></div><div id="module-fields"></div><div class="sidebar-bottom"><span>新模块仅自己可见</span><button class="text-button" id="logout">退出登录</button></div></aside><section class="workspace-preview" aria-label="页面实时预览"><div class="preview-toolbar"><div><strong>预览</strong></div><div class="segmented"><button type="button" id="wide-preview" class="active" aria-pressed="true">宽屏</button><button type="button" id="narrow-preview" aria-pressed="false">窄屏</button></div></div><div class="audience-preview"><span>预览范围</span><div class="segmented"><button type="button" id="private-preview" class="active" aria-pressed="true">全部</button><button type="button" id="public-preview" aria-pressed="false">公开</button></div></div><div class="preview" id="preview"><div class="page-grid" id="preview-page"></div></div></section></main><dialog id="module-picker"><div class="dialog-heading"><div><h2>添加模块</h2></div><button type="button" class="icon-button" id="close-picker" aria-label="关闭">×</button></div><div class="module-options"></div></dialog></div>`;
  mountShell(app, 'edit');
  document.querySelector('#space-settings').append(field('空间名称', state.draft.title, value => { state.draft.title = value; setDirty(); }, { maxLength: 80 }));
  const flow = document.createElement('label'); flow.className = 'field';
  flow.innerHTML = '<span>页面排列</span><select aria-label="页面排列"><option value="grid">对齐网格</option><option value="masonry">瀑布流</option></select>';
  flow.querySelector('select').value = state.draft.flow || 'grid';
  flow.querySelector('select').onchange = event => { state.draft.flow = event.target.value; setDirty(); updatePreview(); };
  document.querySelector('#space-settings').append(flow);
  const help = document.createElement('p'); help.id = 'layout-help'; help.className = 'sr-only'; help.textContent = '拖动 ⠿ 排序，拉动右下角调整大小。键盘：聚焦手柄后用方向键调整，拖动时按 Esc 取消。';
  document.querySelector('.audience-preview').after(help);
  const status = document.createElement('div'); status.id = 'layout-status'; status.className = 'sr-only'; status.setAttribute('role', 'status'); document.querySelector('.workspace-preview').append(status);
  layoutEditor = attachLayoutEditor(document.querySelector('.editor-layout'), {
    getModule(id) { const item = state.draft.modules.find(item => item.id === id); return { meta: definitions.get(item?.type)?.meta.layout, override: item?.layout }; },
    select: selectModule,
    complete: finishArrange,
  });
  document.querySelector('#add-module').onclick = showPalette;
  document.querySelector('#close-picker').onclick = () => document.querySelector('#module-picker').close();
  document.querySelector('#save-draft').onclick = () => save();
  document.querySelector('#publish').onclick = () => save(true);
  document.querySelector('#logout').onclick = logout;
  for (const audience of ['private', 'public']) document.querySelector(`#${audience}-preview`).onclick = () => {
    previewAudience = audience;
    for (const value of ['private', 'public']) { const button = document.querySelector(`#${value}-preview`); button.classList.toggle('active', audience === value); button.setAttribute('aria-pressed', String(audience === value)); }
    updatePreview();
  };
  for (const narrow of [false, true]) document.querySelector(narrow ? '#narrow-preview' : '#wide-preview').onclick = () => {
    document.querySelector('#preview').classList.toggle('narrow', narrow);
    for (const [id, active] of [['#wide-preview', !narrow], ['#narrow-preview', narrow]]) { const button = document.querySelector(id); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  };
  renderModuleList(); renderFields(); updatePreview();
  startRefresh(async () => { await refreshResources(state.draft); updatePreview(); });
}

async function showLab() { await loadModules(true); const { openLab } = await import('./lab.js'); disposeModules(); await openLab({ app, catalog, definitions, request: api }); mountShell(app, 'lab'); }

window.addEventListener('pagehide', disposeModules);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

try {
  if (privateArea) {
    const session = await api('session');
    if (session.authenticated) {
      if (laboratory) await showLab(); else if (editing) await loadEditor(); else await showPrivate();
    } else showLogin();
  } else { await showPublic(); }
} catch (error) {
  app.innerHTML = `<main class="loading-shell"><img src="web/mark.svg" width="42" height="42" alt=""><h1>页面加载失败</h1><p>${escape(error.message)}</p><button class="button primary" id="retry">重新载入</button></main>`;
  document.querySelector('#retry').onclick = () => location.reload();
}
