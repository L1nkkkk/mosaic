import { escape, field, fields, text } from '../../web/ui.js';

// Copy this directory to modules/hello-card/ to install the example.
// When renaming, keep the folder, meta.id and CSS class names in sync.
export const meta = {
  id: 'hello-card',
  name: '问候卡片',
  version: 1,
  description: '一段标题与正文，可适应不同卡片尺寸。',
  layout: { span: 6, minWidth: 280 },
  defaultData: { title: '你好，Mosaic', body: '从第一块内容开始。' },
};

export function validate(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('卡片内容需要是一个对象。');
  }
  return {
    title: text(data.title, 100, '标题', meta.defaultData.title),
    body: text(data.body, 3000, '正文', meta.defaultData.body),
  };
}

export function render(data) {
  return `<article class="hello-card">
    <h2>${escape(data.title)}</h2>
    <p>${escape(data.body)}</p>
  </article>`;
}

export function edit({ data, change }) {
  return fields(
    field('标题', data.title, value => change({ ...data, title: value }),
      { maxLength: 100 }),
    field('正文', data.body, value => change({ ...data, body: value }),
      { multiline: true, maxLength: 3000 }),
  );
}
