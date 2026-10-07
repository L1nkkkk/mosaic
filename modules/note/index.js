import { escape, field, fields, text } from '../../web/ui.js';

export const meta = {
  id: 'note', name: '一则手记', version: 1, description: '放一段近况、一条公告，或一个尚未成形的想法。', layout: 'half',
  defaultData: { label: 'NOW / 此刻', title: '从一块小小的拼图开始。', body: '这是空间的第一则手记。\n\n打开编辑台，试着改一句话、换一下顺序，再把它发布出去。你看到的每一块，都有自己的表达方式。' },
};
export function validate(data = {}) { return { label: text(data.label, 60, '标记'), title: text(data.title, 100, '标题'), body: text(data.body, 3000, '正文') }; }
export function render(data) { return `<article class="note-module"><div class="eyebrow">${escape(data.label)}</div><div class="note-mark" aria-hidden="true">✳</div><h2>${escape(data.title)}</h2><p>${escape(data.body)}</p></article>`; }
export function edit({ data, change }) { return fields(field('标记', data.label, value => change({ ...data, label: value }), { maxLength: 60 }), field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }), field('正文', data.body, value => change({ ...data, body: value }), { multiline: true, maxLength: 3000 })); }
