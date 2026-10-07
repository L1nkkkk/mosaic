import { escape, field, fields, text, safeLink } from '../../web/ui.js';

export const meta = {
  id: 'links', name: '连接清单', version: 1, description: '把作品、项目和常用入口放在一起。', layout: { span: 6, minWidth: 280 },
  defaultData: { title: '在别处，继续探索。', items: [{ label: 'Mosaic · 项目与更新', url: 'https://github.com/L1nkkkk/mosaic' }, { label: 'Link · GitHub', url: 'https://github.com/L1nkkkk' }] },
};
export function validate(data = {}) {
  if (!Array.isArray(data.items) || data.items.length > 8) throw new Error('连接清单最多放置 8 个链接。');
  return { title: text(data.title, 100, '标题'), items: data.items.map(item => ({ label: text(item.label, 80, '链接名称'), url: safeLink(item.url) })) };
}
export function render(data) {
  return `<article class="links-module"><div class="eyebrow">ELSEWHERE / 连接</div><h2>${escape(data.title)}</h2><div class="link-list">${data.items.map((item, index) => `<a href="${escape(safeLink(item.url))}" target="_blank" rel="noopener noreferrer"><span class="link-index">0${index + 1}</span><span>${escape(item.label)}</span><span aria-hidden="true">↗</span></a>`).join('')}</div><div class="links-foot">有趣的东西，值得连接起来。</div></article>`;
}
export function edit({ data, change }) {
  const wrapper = fields(field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }));
  data.items.forEach((item, index) => {
    const update = patch => change({ ...data, items: data.items.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
    const row = fields(field(`链接 ${index + 1} · 名称`, item.label, value => update({ label: value }), { maxLength: 80 }), field('地址', item.url, value => update({ url: value }), { maxLength: 1500, placeholder: 'https://' }));
    row.classList.add('link-editor');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这条链接';
    remove.onclick = () => change({ ...data, items: data.items.filter((_, i) => i !== index) }, true);
    row.append(remove); wrapper.append(row);
  });
  if (data.items.length < 8) {
    const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加链接';
    add.onclick = () => change({ ...data, items: [...data.items, { label: '新的链接', url: 'https://example.com' }] }, true);
    wrapper.append(add);
  }
  return wrapper;
}
