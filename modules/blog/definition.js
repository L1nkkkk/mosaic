import { text } from '../../web/ui.js';

export const meta = {
  id: 'blog', name: '博客', version: 1, description: '列出最近的文章，点开在单独的页面阅读。文章是 GitHub 仓库里的 Markdown 文件，由服务器同步过来。',
  layout: { span: 6, minWidth: 300 },
  defaultData: { title: '文章', count: 5, tag: '' },
};

export function validate(data = {}) {
  const count = data.count === undefined ? 5 : data.count;
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('显示篇数需要是 1 到 30 的整数。');
  return { title: text(data.title, 100, '标题', '文章'), count, tag: text(data.tag, 30, '标签') };
}
