import { escape } from './ui.js';

const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z M13 6l5 5"/>',
  lab: '<path d="M9 3h6M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/>',
  settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/><circle cx="12" cy="12" r="5"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
function preference(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function savePreference(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing can disallow storage. */ } }
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  savePreference('mosaic-theme', theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    button.setAttribute('aria-label', theme === 'dark' ? '切换浅色外观' : '切换深色外观');
  });
}
setTheme(preference('mosaic-theme', 'dark') === 'light' ? 'light' : 'dark');

export function pageHeader({ privateView = false, title }) {
  return `<header class="dashboard-header"><div class="dashboard-top"><button class="shell-menu icon-button" type="button" aria-label="打开导航" aria-expanded="false">${icon('menu')}</button><nav class="space-tabs" aria-label="页面范围"><a href="./" ${!privateView ? 'aria-current="page"' : ''}>公开空间</a><a href="private" ${privateView ? 'aria-current="page"' : ''}>私人空间</a></nav><div class="dashboard-actions"><button id="toggle-search" class="icon-button" aria-label="搜索当前页面模块" aria-expanded="false">${icon('search')}</button><button class="icon-button" data-theme-toggle></button><a class="button primary small" href="edit">${icon('edit')}<span>编辑页面</span></a></div></div><div class="dashboard-intro"><div><span class="space-kicker">${privateView ? 'MY SPACE / 我的空间' : 'A LITTLE WORLD OF MY OWN'}</span><h1>${escape(title)}</h1></div></div><div class="dashboard-search" hidden><label for="module-search">搜索模块</label><input id="module-search" type="search" autocomplete="off" placeholder="输入标题或内容…"><span id="search-status" role="status"></span></div></header>`;
}

export function mountShell(app, active) {
  const content = app.firstElementChild;
  content.classList.add('mosaic-main');
  const layout = document.createElement('div'); layout.className = `mosaic-layout view-${active}`;
  const navigation = [['public', './', 'home', '主页'], ['private', 'private', 'grid', '我的页面'], ['edit', 'edit', 'edit', '编辑台'], ['lab', 'lab', 'lab', '模块实验台']];
  const sidebar = document.createElement('aside'); sidebar.className = 'mosaic-sidebar'; sidebar.id = 'mosaic-navigation';
  sidebar.innerHTML = `<nav aria-label="主导航">${navigation.map(([id, href, glyph, label]) => `<a href="${href}" ${id === active ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}<button type="button" id="appearance-settings">${icon('settings')}<span>外观设置</span></button></nav>`;
  const backdrop = document.createElement('button'); backdrop.className = 'navigation-backdrop'; backdrop.setAttribute('aria-label', '关闭导航'); backdrop.hidden = true;
  layout.append(sidebar, backdrop, content); app.append(layout);
  if (!content.querySelector('.shell-menu')) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'shell-menu icon-button'; button.innerHTML = icon('menu'); button.setAttribute('aria-label', '打开导航'); button.setAttribute('aria-expanded', 'false');
    content.querySelector('header')?.prepend(button);
  }
  const toggle = content.querySelector('.shell-menu'); toggle?.setAttribute('aria-controls', sidebar.id);
  const isMobile = matchMedia('(max-width: 760px)');
  function closeNavigation() { layout.classList.remove('navigation-open'); backdrop.hidden = true; toggle?.setAttribute('aria-expanded', 'false'); syncNavigation(); }
  function syncNavigation() { const open = isMobile.matches && layout.classList.contains('navigation-open'); sidebar.inert = isMobile.matches && !open; content.inert = open; document.body.classList.toggle('navigation-visible', open); }
  toggle.onclick = () => {
    const open = layout.classList.toggle('navigation-open'); backdrop.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); syncNavigation();
    if (open) sidebar.querySelector('nav a').focus();
  };
  backdrop.onclick = closeNavigation;
  layout.addEventListener('keydown', event => {
    if (!layout.classList.contains('navigation-open') || layout.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') { closeNavigation(); toggle.focus(); }
    if (event.key === 'Tab') {
      const focusable = [...sidebar.querySelectorAll('a,button')], first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  // App views can be replaced after login; no global listeners retain an old shell.
  isMobile.onchange = () => { if (!layout.isConnected) { isMobile.onchange = null; return; } closeNavigation(); };
  syncNavigation();
  app.querySelectorAll('[data-theme-toggle]').forEach(button => { button.onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); });
  setTheme(document.documentElement.dataset.theme);
  sidebar.querySelector('#appearance-settings').onclick = async () => {
    const { openAppearance } = await import('./appearance.js');
    await openAppearance(layout, setTheme);
  };
}
