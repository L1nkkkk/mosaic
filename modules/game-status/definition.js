import { text } from '../../web/ui.js';
export const meta = { id: 'game-status', name: '游戏状态', version: 1, privateOnly: true,
  description: '原神、明日方舟与终末地的体力、回满时间和每日进度。',
  layout: { span: 12, minWidth: 300 }, defaultData: { title: '我的游戏' } };
export function validate(data = {}) { return { title: text(data.title, 100, '标题', '我的游戏') }; }
