import { escape, field } from './ui.js';

const app = document.querySelector('#app');
const definitions = new Map();
let catalog = [];
let state;
let selected;
let dirty = false;
let busy = false;
let noticeTimer;
const editing = /\/edit\/?$/.test(location.pathname);
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

async function loadModules() {
  catalog = (await api('modules')).modules;
  await Promise.all(catalog.map(async meta => {
    try {
      const module = await import(new URL(meta.entry, document.baseURI));
      definitions.set(meta.id, module);
      const style = document.createElement('link');
      style.rel = 'stylesheet'; style.href = new URL(`modules/${meta.id}/style.css`, document.baseURI);
      document.head.append(style);
    } catch { definitions.set(meta.id, null); }
  }));
}

function renderPage(page, destination) {
  destination.replaceChildren();
  const visible = page.modules.filter(module => module.visible !== false);
  if (!visible.length) destination.innerHTML = '<div class="empty-state"><h2>留白，也是一种开始。</h2><p>内容准备好后，会在这里与你见面。</p></div>';
  for (const item of visible) {
    const module = definitions.get(item.type);
    const slot = document.createElement('section');
    slot.className = `module-slot ${module?.meta.layout === 'wide' ? 'wide' : 'half'}`;
    slot.dataset.moduleId = item.id;
    try {
      if (!module) throw new Error('Module unavailable');
      slot.innerHTML = module.render(item.data);
    } catch {
      slot.innerHTML = '<article class="module-error"><h2>这块内容暂时无法显示</h2><p>内容已保留，其他模块仍可正常浏览。</p></article>';
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
  app.innerHTML = `<div class="public-shell"><header class="site-header"><a class="brand" href="./" aria-label="Mosaic 首页">${logo}</a><div class="header-right"><span class="space-label">${escape(page.title)}</span><a class="button outline small" href="edit">进入编辑台 <span aria-hidden="true">↗</span></a></div></header><main id="main"><div class="page-heading"><span>YOUR PERSONAL CANVAS</span><span>自由组合 · 持续生长</span></div><div class="page-grid" id="public-page"></div></main>${footer(version)}</div>`;
  renderPage(page, document.querySelector('#public-page'));
}

function showLogin() {
  app.innerHTML = `<div class="public-shell"><header class="site-header"><a class="brand" href="./">${logo}</a><a class="text-button" href="./">返回展示页 ↗</a></header><main id="main" class="login-main"><section class="login-card"><div class="eyebrow">YOUR PRIVATE WORKSPACE</div><h1>继续，拼出你的空间。</h1><p>用管理密码进入编辑台。所有改动都可以先预览，再发布。</p><form id="login-form"><label class="field"><span>管理密码</span><input name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="输入管理密码"></label><p id="login-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">进入编辑台 <span aria-hidden="true">→</span></button></form><div class="login-caption"><span class="dot"></span> 公开展示，私密编辑。</div></section><div class="login-art" aria-hidden="true"><img src="web/mark.svg" alt=""><span>MAKE ROOM<br>FOR YOUR IDEAS.</span></div></main>${footer()}</div>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      await api('login', { method: 'POST', body: JSON.stringify({ password: new FormData(event.target).get('password') }) });
      await loadEditor();
    } catch (error) { document.querySelector('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

function setDirty() { dirty = true; document.querySelector('#save-status').textContent = '有未保存的改动'; }
function updatePreview() { renderPage(state.draft, document.querySelector('#preview-page')); }

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
    row.className = `module-row${selected === item.id ? ' selected' : ''}${item.visible === false ? ' hidden-module' : ''}`;
    row.innerHTML = `<button type="button" class="module-select" aria-pressed="${selected === item.id}"><span class="module-number">${String(index + 1).padStart(2, '0')}</span><span><strong>${escape(meta?.name || item.type)}</strong><small>${escape((item.data.title || item.data.label || '模块内容').replaceAll('\n', ' '))}</small></span></button><div class="row-controls"><button type="button" data-action="up" title="向上移动" aria-label="向上移动 ${escape(meta?.name || '模块')}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-action="down" title="向下移动" aria-label="向下移动 ${escape(meta?.name || '模块')}" ${index === state.draft.modules.length - 1 ? 'disabled' : ''}>↓</button></div>`;
    row.querySelector('.module-select').onclick = () => { selected = item.id; renderModuleList(); renderFields(); };
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
  controls.append(visibility, remove); container.append(controls);
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
      const item = { id: crypto.randomUUID(), type: meta.id, visible: true, data: structuredClone(meta.defaultData) };
      state.draft.modules.push(item); selected = item.id; setDirty(); renderModuleList(); renderFields(); updatePreview(); dialog.close();
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
      document.querySelector('#save-status').textContent = '已发布，访客现在可以看到';
      notice('发布成功，展示页已经更新。');
    } else notice('草稿已保存，展示页保持当前发布版本。');
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) document.querySelector('#save-status').textContent = '登录已过期，请重新登录；先复制尚未保存的内容';
  } finally { busy = false; document.querySelector('.editor-layout').inert = false; buttons.forEach(button => { button.disabled = false; }); }
}

async function loadEditor() {
  state = await api('admin/state'); dirty = false; selected = state.draft.modules[0]?.id;
  document.title = '编辑台 · Mosaic';
  app.innerHTML = `<div class="editor-shell"><header class="editor-header"><a class="brand" href="./">${logo}</a><span class="workspace-badge">编辑台</span><span id="save-status" role="status">所有草稿已保存</span><div class="editor-toolbar"><a class="text-button" href="./" target="_blank" rel="noopener">查看展示页 ↗</a><button class="button outline" id="save-draft">保存草稿</button><button class="button primary" id="publish">发布更改 <span aria-hidden="true">↗</span></button></div></header><main id="main" class="editor-layout"><aside class="editor-sidebar"><div class="sidebar-intro"><div class="eyebrow">BUILD YOUR SPACE</div><h1>一块一块，拼出你的样子。</h1></div><div id="space-settings"></div><div class="section-heading"><h2>页面模块 <span id="module-count"></span></h2><button class="text-button" id="add-module">＋ 添加</button></div><div id="module-list"></div><div id="module-fields"></div><div class="sidebar-bottom"><span>草稿与展示内容独立保存</span><button class="text-button" id="logout">退出登录</button></div></aside><section class="workspace-preview" aria-label="页面实时预览"><div class="preview-toolbar"><div><strong>实时预览</strong><span>发布后，访客才会看到这些改动。</span></div><div class="segmented"><button type="button" id="wide-preview" class="active" aria-pressed="true">宽屏</button><button type="button" id="narrow-preview" aria-pressed="false">窄屏</button></div></div><div class="preview" id="preview"><div class="preview-topline"><span>Mosaic</span><span class="dot"></span></div><div class="page-grid" id="preview-page"></div><div class="preview-bottomline">YOUR PERSONAL CANVAS</div></div></section></main><dialog id="module-picker"><div class="dialog-heading"><div><div class="eyebrow">ADD A LITTLE SOMETHING</div><h2>给空间加一块内容。</h2></div><button type="button" class="icon-button" id="close-picker" aria-label="关闭">×</button></div><div class="module-options"></div></dialog></div>`;
  document.querySelector('#space-settings').append(field('空间名称', state.draft.title, value => { state.draft.title = value; setDirty(); }, { maxLength: 80 }));
  document.querySelector('#add-module').onclick = showPalette;
  document.querySelector('#close-picker').onclick = () => document.querySelector('#module-picker').close();
  document.querySelector('#save-draft').onclick = () => save();
  document.querySelector('#publish').onclick = () => save(true);
  document.querySelector('#logout').onclick = async () => {
    if (dirty && !confirm('还有未保存的改动，确定退出吗？')) return;
    try { await api('logout', { method: 'POST', body: '{}' }); dirty = false; showLogin(); } catch (error) { notice(error.message, true); }
  };
  for (const narrow of [false, true]) document.querySelector(narrow ? '#narrow-preview' : '#wide-preview').onclick = () => {
    document.querySelector('#preview').classList.toggle('narrow', narrow);
    for (const [id, active] of [['#wide-preview', !narrow], ['#narrow-preview', narrow]]) { const button = document.querySelector(id); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
  };
  renderModuleList(); renderFields(); updatePreview();
}

window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

try {
  await loadModules();
  if (editing) {
    const session = await api('session');
    if (session.authenticated) await loadEditor(); else showLogin();
  } else await showPublic();
} catch (error) {
  app.innerHTML = `<main class="loading-shell"><img src="web/mark.svg" width="42" height="42" alt=""><h1>空间暂时没有打开。</h1><p>${escape(error.message)}</p><button class="button primary" id="retry">重新载入</button></main>`;
  document.querySelector('#retry').onclick = () => location.reload();
}
