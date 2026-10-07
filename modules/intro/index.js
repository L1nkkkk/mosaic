import { escape, field, fields, text } from '../../web/ui.js';

export const meta = {
  id: 'intro', name: '开场介绍', version: 1, description: '用一句话和一段介绍，为空间定下基调。', layout: 'wide',
  defaultData: { eyebrow: 'A SPACE TO MAKE YOUR OWN', title: '给想法，\n留一块自己的空间。', body: '你好，欢迎来到 Mosaic。这里的文字、链接和小小的灵感，都可以自由组合，慢慢长成你的样子。' },
};
export function validate(data = {}) { return { eyebrow: text(data.eyebrow, 80, '上方小标题'), title: text(data.title, 100, '标题'), body: text(data.body, 1800, '介绍') }; }
export function render(data) {
  return `<article class="intro-module"><div class="eyebrow">${escape(data.eyebrow)}</div><h1>${escape(data.title)}</h1><p>${escape(data.body)}</p><div class="intro-bottom"><span class="dot"></span> 一个正在生长的空间 <span class="intro-number">01 / BEGIN HERE</span></div><div class="tile-art" aria-hidden="true"><i></i><i></i><i></i><i></i></div></article>`;
}
export function edit({ data, change }) {
  return fields(field('上方小标题', data.eyebrow, value => change({ ...data, eyebrow: value }), { maxLength: 80 }), field('标题', data.title, value => change({ ...data, title: value }), { multiline: true, maxLength: 100 }), field('介绍', data.body, value => change({ ...data, body: value }), { multiline: true, maxLength: 1800 }));
}
