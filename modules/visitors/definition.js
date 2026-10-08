import { text } from '../../web/ui.js';
export const meta = { id: 'visitors', name: '访客来源', version: 1, layout: { span: 4, minWidth: 260 }, description: '实际访问计数与最近 30 天地区分布，公开此模块后开始统计。', defaultData: { title: '访客来自' } };
export function validate(data = {}) { return { title: text(data.title, 100, '标题') }; }
