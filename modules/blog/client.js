import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
export async function load({ request }) { return request('blog'); }
const moment = value => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '从未';
export function edit({ data, change }) {
  const wrapper = fields(field('标题', data.title, title => change({ title }), { maxLength: 100 }));
  const count = field('显示篇数（1–30）', String(data.count), value => { const number = Number(value); if (Number.isInteger(number) && number >= 1 && number <= 30) change({ count: number }); }, { maxLength: 2 });
  count.querySelector('input').inputMode = 'numeric';
  wrapper.append(count, field('只显示这个标签（可选）', data.tag, tag => change({ tag }), { maxLength: 30, placeholder: '留空显示全部' }));
  // Where the posts come from is server configuration; the editor can only look and ask for a fresh copy.
  const source = document.createElement('div'); source.className = 'module-fields blog-source';
  const status = document.createElement('p'); status.className = 'muted'; status.setAttribute('role', 'status'); status.textContent = '正在读取仓库状态…';
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button subtle'; button.textContent = '立即同步'; button.disabled = true;
  const show = value => {
    button.disabled = !value.configured;
    status.textContent = !value.configured ? '还没有连接仓库：在服务器的环境配置里设置 BLOG_REPO（owner/name），重启后生效。'
      : `${value.status.repo} · ${value.posts.length} 篇 · 上次同步 ${moment(value.syncedAt)}${value.status.error ? `。${value.status.error}` : ''}`;
  };
  const call = async options => {
    const response = await fetch(new URL(options ? 'api/admin/blog/sync' : 'api/blog', document.baseURI), { credentials: 'same-origin', cache: 'no-store', ...options });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || '暂时读取不到。');
    return value;
  };
  call().then(show, error => { status.textContent = error.message; });
  button.onclick = async () => {
    button.disabled = true; status.textContent = '正在同步…';
    try { show(await call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }
    catch (error) { status.textContent = error.message; button.disabled = false; }
  };
  const help = document.createElement('p'); help.className = 'scope-help'; help.textContent = '文章放在仓库的 posts/ 目录，每篇一个 Markdown 文件；推送后几分钟内自动同步，不需要发布。';
  source.append(status, button, help); wrapper.append(source);
  return wrapper;
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'blog-module'; card.dataset.ownBackground = '';
  card.innerHTML = '<header><h2></h2><span class="blog-total"></span></header><ol class="blog-list"></ol><p class="blog-empty" role="status"></p>';
  context.root.append(card);
  const list = card.querySelector('ol'), empty = card.querySelector('.blog-empty'); let shown;
  return { update(data, resource) {
    card.querySelector('h2').textContent = data.title;
    const value = resource?.value, all = (value?.posts || []).filter(post => !data.tag || post.tags.includes(data.tag)), posts = all.slice(0, data.count);
    card.querySelector('.blog-total').textContent = all.length ? `${all.length} 篇` : '';
    empty.textContent = posts.length ? '' : resource?.error ? '文章暂时读取不到，稍后重试。' : !value ? '正在翻开…' : !value.configured && context.writable ? '还没有连接博客仓库，在编辑台查看设置方法。' : data.tag && value.posts.length ? `没有带「${data.tag}」标签的文章。` : '还没有文章。';
    empty.hidden = posts.length > 0;
    // The list is rebuilt only when what it shows changes, so a refresh never interrupts a reader.
    const signature = JSON.stringify(posts);
    if (signature === shown) return;
    shown = signature;
    list.replaceChildren(...posts.map(post => {
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = new URL(`post/${encodeURIComponent(post.slug)}`, document.baseURI);
      // Leaving the editor or the lab would drop unsaved work, so there a post opens beside it.
      if (context.view === 'edit' || context.view === 'lab') { link.target = '_blank'; link.rel = 'noopener'; }
      const date = document.createElement('time'), title = document.createElement('strong'), summary = document.createElement('p'), foot = document.createElement('span');
      date.dateTime = post.date; date.textContent = post.date.replaceAll('-', '.') || '未注明日期';
      title.textContent = post.title; summary.textContent = post.summary; summary.hidden = !post.summary;
      foot.className = 'blog-foot'; foot.textContent = [...post.tags.map(tag => `#${tag}`), ...(post.kind === 'page' ? ['可交互'] : []), `${post.minutes} 分钟`].join('  ');
      link.append(date, title, summary, foot); item.append(link);
      return item;
    }));
  } };
}
