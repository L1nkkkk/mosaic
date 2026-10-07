import { escape, field, fields, text } from '../../web/ui.js';

export const meta = {
  id: 'note', name: '一则手记', version: 1, description: '放一段近况、一条公告，或一个尚未成形的想法。', layout: { span: 6, minWidth: 280 },
  defaultData: { label: '', title: '近况', body: '写点最近的事。' },
};
export function validate(data = {}) { return { label: text(data.label, 60, '标记'), title: text(data.title, 100, '标题'), body: text(data.body, 3000, '正文') }; }
export function render(data) { return `<article class="note-module">${data.label && data.label !== 'NOW / 此刻' ? `<div class="eyebrow">${escape(data.label)}</div>` : ''}<h2>${escape(data.title)}</h2><p>${escape(data.body)}</p></article>`; }
export function edit({ data, change }) { return fields(field('标记', data.label, value => change({ ...data, label: value }), { maxLength: 60 }), field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }), field('正文', data.body, value => change({ ...data, body: value }), { multiline: true, maxLength: 3000 })); }
