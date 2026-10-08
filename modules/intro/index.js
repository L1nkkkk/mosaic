import { escape, field, fields, text } from '../../web/ui.js';

export const meta = {
  id: 'intro', name: '开场介绍', version: 1, description: '用一句话和一段介绍，为空间定下基调。', layout: { span: 4, minWidth: 260 },
  defaultData: { eyebrow: '', title: '你好，我是 Link。', body: '这里记录我的近况、项目和常用链接。' },
};
export function validate(data = {}) { return { eyebrow: text(data.eyebrow, 80, '上方小标题'), title: text(data.title, 100, '标题'), body: text(data.body, 1800, '介绍') }; }
export function render(data) {
  return `<article class="intro-module" data-own-background>${data.eyebrow && data.eyebrow !== 'A SPACE TO MAKE YOUR OWN' ? `<div class="eyebrow">${escape(data.eyebrow)}</div>` : ''}<h1>${escape(data.title)}</h1><p>${escape(data.body)}</p></article>`;
}
export function edit({ data, change }) {
  return fields(field('上方小标题', data.eyebrow, value => change({ ...data, eyebrow: value }), { maxLength: 80 }), field('标题', data.title, value => change({ ...data, title: value }), { multiline: true, maxLength: 100 }), field('介绍', data.body, value => change({ ...data, body: value }), { multiline: true, maxLength: 1800 }));
}
