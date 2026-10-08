import { text } from '../../web/ui.js';
export const meta = {
  id: 'live-card', name: '交互卡片', version: 1,
  description: '可复制的生命周期模块：临时点击状态与持久内容分开。',
  layout: { span: 6, minWidth: 240 },
  defaultData: { title: '你好，Mosaic' },
};
export function validate(data = {}) { return { title: text(data.title, 100, '标题') }; }
