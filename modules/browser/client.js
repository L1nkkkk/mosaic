import { field, fields } from '../../web/ui.js';
import { resolveAddress } from './address.js';
export { validate } from './definition.js';

// No allow-top-navigation: a framed site must not be able to replace the Mosaic page.
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation';
const ALLOW = 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write';
const key = id => `mosaic-browser:${id}`;
const recall = id => { try { const url = localStorage.getItem(key(id)) || ''; return url.startsWith('https://') ? url : ''; } catch { return ''; } };
const remember = (id, url) => { try { localStorage.setItem(key(id), url); } catch { /* Private mode: start from the home page next time. */ } };

export function edit({ data, change }) {
  const wrapper = fields(
    field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }),
    field('主页', data.home, value => change({ ...data, home: value }), { maxLength: 1500, placeholder: 'https://' }),
    field('搜索地址（%s 为关键词）', data.search, value => change({ ...data, search: value }), { maxLength: 1500, placeholder: 'https://' }),
  );
  data.bookmarks.forEach((item, index) => {
    const update = patch => change({ ...data, bookmarks: data.bookmarks.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
    const row = fields(field(`书签 ${index + 1} · 名称`, item.label, value => update({ label: value }), { maxLength: 40 }), field('地址', item.url, value => update({ url: value }), { maxLength: 1500, placeholder: 'https://' }));
    row.classList.add('link-editor');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这个书签';
    remove.onclick = () => change({ ...data, bookmarks: data.bookmarks.filter((_, i) => i !== index) }, true);
    row.append(remove); wrapper.append(row);
  });
  if (data.bookmarks.length < 12) {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加书签';
    add.onclick = () => change({ ...data, bookmarks: [...data.bookmarks, { label: '新的书签', url: 'https://example.com/' }] }, true);
    wrapper.append(add);
  }
  return wrapper;
}

export function mount(context) {
  const card = document.createElement('article'); card.className = 'browser-module';
  card.innerHTML = '<div class="browser-bar"><button type="button" data-action="back" aria-label="后退" title="后退">←</button><button type="button" data-action="forward" aria-label="前进" title="前进">→</button><button type="button" data-action="reload" aria-label="刷新" title="刷新">↻</button><button type="button" data-action="home" aria-label="主页" title="主页">⌂</button><form><input name="address" aria-label="地址" autocomplete="off" spellcheck="false" placeholder="输入网址或搜索"></form><a class="browser-open" target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开" title="在新标签页打开">↗</a></div><nav class="browser-marks" aria-label="书签"></nav><div class="browser-view"></div>';
  context.root.append(card);
  const form = card.querySelector('form'), input = form.elements.address, open = card.querySelector('.browser-open');
  const marks = card.querySelector('.browser-marks'), view = card.querySelector('.browser-view');
  const [back, forward] = card.querySelectorAll('button');
  const extension = () => Boolean(document.documentElement.dataset.mosaicBrowser);
  // The editor and the lab stay idle until asked, so arranging modules never starts a site.
  let data, frame, trail = [], index = -1, settled = true, started = !['edit', 'lab'].includes(context.view);

  function notice(message, action) {
    frame = undefined;
    const box = document.createElement('div'), copy = document.createElement('p');
    box.className = 'browser-notice'; copy.textContent = message; box.append(copy);
    if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = '加载页面'; button.addEventListener('click', action, { signal: context.signal }); box.append(button); }
    view.replaceChildren(box);
  }
  function current(url) {
    if (document.activeElement !== input) input.value = url;
    open.href = url; remember(context.id, url);
    back.disabled = index <= 0; forward.disabled = index >= trail.length - 1;
  }
  function load(url) {
    current(url);
    if (!extension()) return notice('需要安装并配置 Mosaic Browser 扩展后，才能在这里打开网站。也可以用右上角的 ↗ 在新标签页打开。');
    if (!started) return notice('编辑和实验时不会自动打开网站。', () => { started = true; load(trail[index]); });
    if (!frame) {
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', SANDBOX); frame.allow = ALLOW; frame.referrerPolicy = 'no-referrer';
      view.replaceChildren(frame);
    }
    frame.title = data.title || '浏览器'; frame.src = url; settled = false;
  }
  function visit(url) {
    if (!url) return;
    trail.length = index + 1; trail.push(url); index++;
    load(url);
  }
  const step = offset => { if (trail[index + offset]) { index += offset; load(trail[index]); } };

  card.querySelector('.browser-bar').addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.action;
    if (action === 'back') step(-1); else if (action === 'forward') step(1);
    else if (action === 'reload') load(trail[index]); else if (action === 'home') visit(data.home);
  }, { signal: context.signal });
  form.addEventListener('submit', event => { event.preventDefault(); input.blur(); visit(resolveAddress(input.value, data.search)); }, { signal: context.signal });
  marks.addEventListener('click', event => { const url = event.target.closest('button')?.dataset.url; if (url) visit(url); }, { signal: context.signal });
  // The extension's frame script reports where the framed page went; nothing else is accepted.
  addEventListener('message', event => {
    const message = event.data;
    if (!frame || event.source !== frame.contentWindow || message?.mosaicBrowser !== 1 || message.type !== 'navigated') return;
    if (typeof message.url !== 'string' || !message.url.startsWith('https://') || message.url.length > 4096) return;
    // The first report after a load is where that address landed; a redirect must not trap the back button.
    if (!settled) { settled = true; trail[index] = message.url; }
    else if (message.url !== trail[index]) { trail.length = index + 1; trail.push(message.url); index++; }
    current(message.url);
  }, { signal: context.signal });
  // The extension marks the page once its rules are active, possibly after this module mounted.
  const marker = new MutationObserver(() => { if (extension() && !frame && index >= 0) load(trail[index]); });
  marker.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mosaic-browser'] });

  return {
    update(next) {
      data = next;
      marks.replaceChildren(...data.bookmarks.map(item => { const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label; button.dataset.url = item.url; return button; }));
      marks.hidden = !data.bookmarks.length;
      if (index < 0) visit(recall(context.id) || data.home);
    },
    dispose() { marker.disconnect(); if (frame) { frame.src = 'about:blank'; frame.remove(); } },
  };
}
