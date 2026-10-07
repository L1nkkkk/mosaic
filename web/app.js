import { escape, field } from './ui.js';

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
const resources = new Map();
const editing = /\/edit\/?$/.test(location.pathname);
const privateArea = editing || /\/private\/?$/.test(location.pathname);
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

async function loadModules(privateAccess = false) {
  catalog = (await api(privateAccess ? 'admin/modules' : 'modules')).modules;
  await Promise.all(catalog.map(async meta => {
    try {
      const module = await import(new URL(meta.entry, document.baseURI));
      definitions.set(meta.id, module);
      if (!document.querySelector(`link[data-module-style="${meta.id}"]`)) {
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
  await Promise.all([...new Set(page.modules.map(item => item.type))].map(async type => {
    const module = definitions.get(type);
    if (!module?.load) return;
    try { resources.set(type, { value: await module.load({ request }) }); }
    catch (error) { resources.set(type, { error: '状态暂时无法读取' }); if (error.status === 401) throw error; }
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
  destination.replaceChildren();
  const visible = audience === 'private' ? page.modules : page.modules.filter(module => module.audience !== 'private' && module.visible !== false && !definitions.get(module.type)?.meta.privateOnly);
  if (!visible.length) destination.innerHTML = '<div class="empty-state"><h2>留白，也是一种开始。</h2><p>内容准备好后，会在这里与你见面。</p></div>';
  for (const item of visible) {
    const module = definitions.get(item.type);
    const slot = document.createElement('section');
    slot.className = `module-slot ${module?.meta.layout === 'wide' ? 'wide' : 'half'}`;
    slot.dataset.moduleId = item.id;
    try {
      if (!module) throw new Error('Module unavailable');
      slot.innerHTML = module.render(item.data, resources.get(item.type));
    } catch {
      slot.innerHTML = '<article class="module-error"><h2>这块内容暂时无法显示</h2><p>内容已保留，其他模块仍可正常浏览。</p></article>';
    }
    if (audience === 'private') {
      slot.classList.add('with-badge');
      const badge = document.createElement('div'); badge.className = 'module-caption';
      badge.innerHTML = `<span class="audience-badge ${item.audience === 'private' ? 'private' : 'public'}">${item.audience === 'private' ? 'Private · 仅自己' : 'Public · 公开模块'}</span>${item.audience !== 'private' && item.visible === false ? '<span class="hidden-caption">暂不公开展示</span>' : ''}`;
      slot.prepend(badge);
    }
    destination.append(slot);
  }
}

function footer(version = '') {
  return `<footer class="site-footer"><span>用小小的模块，装下大大的想法。</span><span>Mosaic${version ? ` / ${escape(version)}` : ''} <span class="footer-symbol">✳</span></span></footer>`;
}

async function showPublic() {
  const { page, version } = await api('page');
  document.title = page.title;
  app.innerHTML = `<div class="public-shell"><header class="site-header"><a class="brand" href="./" aria-label="Mosaic 首页">${logo}</a><div class="header-right"><span class="space-label">${escape(page.title)}</span><a class="button outline small" href="private">私人空间 <span aria-hidden="true">↗</span></a></div></header><main id="main"><div class="page-heading"><span>PUBLIC / 公开展示</span><span>自由组合 · 持续生长</span></div><div class="page-grid" id="public-page"></div></main>${footer(version)}</div>`;
  renderPage(page, document.querySelector('#public-page'));
}

function showLogin() {
  clearInterval(resourceTimer);
  document.title = '登录 · Mosaic';
  const destination = editing ? '编辑台' : '私人空间';
  app.innerHTML = `<div class="public-shell"><header class="site-header"><a class="brand" href="./">${logo}</a><a class="text-button" href="./">返回公开页 ↗</a></header><main id="main" class="login-main"><section class="login-card"><div class="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>你的空间，只为你打开。</h1><p>登录后查看全部模块、服务器与 Bot 状态，也可以继续编辑你的展示页。</p><form id="login-form"><label class="field"><span>管理密码</span><input name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="输入管理密码"></label><p id="login-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">进入${destination} <span aria-hidden="true">→</span></button></form><div class="login-caption"><span class="dot"></span> Public 对外展示，Private 仅自己可见。</div></section><div class="login-art" aria-hidden="true"><img src="web/mark.svg" alt=""><span>A LITTLE SPACE<br>JUST FOR YOU.</span></div></main>${footer()}</div>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) });
      await loadModules(true);
      if (editing) await loadEditor(); else await showPrivate();
    } catch (error) { document.querySelector('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

async function logout() {
  if (dirty && !confirm('还有未保存的改动，确定退出吗？')) return;
  try { await api('logout', { method: 'POST', body: '{}' }); dirty = false; resources.clear(); showLogin(); } catch (error) { notice(error.message, true); }
}

async function showPrivate() {
  const first = await api('private/page');
  document.title = '私人空间 · Mosaic';
  app.innerHTML = `<div class="public-shell private-shell"><header class="site-header"><a class="brand" href="private">${logo}</a><nav class="private-nav" aria-label="空间导航"><a class="text-button" href="./">Public 公开页 ↗</a><a class="button primary small" href="edit">编辑模块</a><button class="text-button" id="private-logout">退出</button></nav></header><main id="main"><div class="private-heading"><div><div class="eyebrow">PRIVATE / 我的空间</div><h1>所有模块，都在这里。</h1><p>查看全部已保存内容与运行状态。只有已发布的 Public 模块会出现在公开页。</p></div><button class="button outline small" id="refresh-private">刷新状态 ↻</button></div><div class="private-summary"><span id="private-count"></span><span>已保存内容 · 每 30 秒刷新</span></div><div class="page-grid" id="private-page"></div></main>${footer(first.version)}</div>`;
  document.querySelector('#private-logout').onclick = logout;
  let refreshing = false;
  const refresh = async initial => {
    if (refreshing) return;
    refreshing = true;
    try {
      const { page } = initial || await api('private/page');
      await refreshResources(page);
      const privateCount = page.modules.filter(item => item.audience === 'private').length;
      document.querySelector('#private-count').textContent = `${page.modules.length} 个模块 · ${privateCount} 个 Private`;
      renderPage(page, document.querySelector('#private-page'), 'private');
    } finally { refreshing = false; }
  };
  document.querySelector('#refresh-private').onclick = async () => { try { await refresh(); notice('已读取最新状态。'); } catch (error) { if (error.status === 401) showLogin(); else notice(error.message, true); } };
  await refresh(first);
  startRefresh(refresh);
}

function setDirty() { dirty = true; document.querySelector('#save-status').textContent = '有未保存的改动'; }
function updatePreview() { renderPage(state.draft, document.querySelector('#preview-page'), previewAudience); }

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
    row.className = `module-row${selected === item.id ? ' selected' : ''}${item.audience !== 'private' && item.visible === false ? ' hidden-module' : ''}`;
    row.innerHTML = `<button type="button" class="module-select" aria-pressed="${selected === item.id}"><span class="module-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(meta?.name || item.type)}</strong><small>${escape((item.data.title || item.data.label || '模块内容').replaceAll('\n', ' '))}</small></span></button><div class="row-controls"><button type="button" data-action="up" title="向上移动" aria-label="向上移动 ${escape(meta?.name || '模块')}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="down" title="向下移动" aria-label="向下移动 ${escape(meta?.name || '模块')}" ${index === state.draft.modules.length - 1 ? 'disabled' : ''}>↓</button></div>`;
    row.querySelector('.module-select').onclick = () => { selected = item.id; renderModuleList(); renderFields(); };
    const scope = document.createElement('span'); scope.className = `row-audience ${item.audience === 'private' ? 'private' : ''}`; scope.textContent = item.audience === 'private' ? 'Private' : 'Public';
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
  heading.innerHTML = `<h3>${escape(module?.meta.name || '模块设置')}</h3><span>编辑内容</span>`;
  container.append(heading);
  const audienceField = document.createElement('label'); audienceField.className = 'field';
  audienceField.innerHTML = '<span>显示范围</span><select aria-label="显示范围"><option value="private">Private · 仅自己可见</option><option value="public">Public · 可以公开展示</option></select>';
  const audienceSelect = audienceField.querySelector('select'); audienceSelect.value = item.audience || 'public'; audienceSelect.disabled = Boolean(module?.meta.privateOnly);
  audienceSelect.onchange = () => { item.audience = audienceSelect.value; item.visible = item.audience === 'public'; setDirty(); renderModuleList(); renderFields(); updatePreview(); };
  container.append(audienceField);
  const scopeHelp = document.createElement('p'); scopeHelp.className = 'scope-help'; scopeHelp.textContent = module?.meta.privateOnly ? '此模块固定为 Private，无法公开。' : '改成 Private 并保存后立即撤下公开内容。改成 Public 后还需要发布。'; container.append(scopeHelp);
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
      notice('Public 内容已发布，Private 内容仅自己可见。');
    } else notice('已保存到私人页；Private 模块不会在公开页显示。');
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) document.querySelector('#save-status').textContent = '登录已过期，请重新登录；先复制尚未保存的内容';
  } finally { busy = false; document.querySelector('.editor-layout').inert = false; buttons.forEach(button => { button.disabled = false; }); }
}

async function loadEditor() {
  state = await api('admin/state'); dirty = false; selected = state.draft.modules[0]?.id;
  previewAudience = 'private';
  await refreshResources(state.draft);
  document.title = '编辑台 · Mosaic';
  app.innerHTML = `<div class="editor-shell"><header class="editor-header"><a class="brand" href="private">${logo}</a><span class="workspace-badge">编辑台</span><span id="save-status" role="status">所有草稿已保存</span><div class="editor-toolbar"><a class="text-button" href="./" target="_blank" rel="noopener">Public ↗</a><a class="text-button" href="private" target="_blank" rel="noopener">Private ↗</a><button class="button outline" id="save-draft">保存草稿</button><button class="button primary" id="publish">发布公开内容 <span aria-hidden="true">↗</span></button></div></header><main id="main" class="editor-layout"><aside class="editor-sidebar"><div class="sidebar-intro"><div class="eyebrow">BUILD YOUR SPACE</div><h1>一块一块，拼出你的样子。</h1></div><div id="space-settings"></div><div class="section-heading"><h2>页面模块 <span id="module-count"></span></h2><button class="text-button" id="add-module">＋ 添加</button></div><div id="module-list"></div><div id="module-fields"></div><div class="sidebar-bottom"><span>新模块默认 Private</span><button class="text-button" id="logout">退出登录</button></div></aside><section class="workspace-preview" aria-label="页面实时预览"><div class="preview-toolbar"><div><strong>实时预览</strong><span>公开页以发布版本为准。</span></div><div class="segmented"><button type="button" id="wide-preview" class="active" aria-pressed="true">宽屏</button><button type="button" id="narrow-preview" aria-pressed="false">窄屏</button></div></div><div class="audience-preview"><span>预览范围</span><div class="segmented"><button type="button" id="private-preview" class="active" aria-pressed="true">Private · 全部</button><button type="button" id="public-preview" aria-pressed="false">Public · 公开</button></div></div><div class="preview" id="preview"><div class="preview-topline"><span>Mosaic</span><span class="dot"></span></div><div class="page-grid" id="preview-page"></div><div class="preview-bottomline">YOUR PERSONAL CANVAS</div></div></section></main><dialog id="module-picker"><div class="dialog-heading"><div><div class="eyebrow">ADD A LITTLE SOMETHING</div><h2>给空间加一块内容。</h2></div><button type="button" class="icon-button" id="close-picker" aria-label="关闭">×</button></div><div class="module-options"></div></dialog></div>`;
  document.querySelector('#space-settings').append(field('空间名称', state.draft.title, value => { state.draft.title = value; setDirty(); }, { maxLength: 80 }));
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

window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pageshow', event => { if (event.persisted && privateArea) location.reload(); });

try {
  if (privateArea) {
    const session = await api('session');
    if (session.authenticated) {
      await loadModules(true);
      if (editing) await loadEditor(); else await showPrivate();
    } else showLogin();
  } else { await loadModules(); await showPublic(); }
} catch (error) {
  app.innerHTML = `<main class="loading-shell"><img src="web/mark.svg" width="42" height="42" alt=""><h1>空间暂时没有打开。</h1><p>${escape(error.message)}</p><button class="button primary" id="retry">重新载入</button></main>`;
  document.querySelector('#retry').onclick = () => location.reload();
}
