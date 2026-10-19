import { text, safeLink } from '../../web/ui.js';
import { LEVELS } from './plan.js';
export const meta = {
  id: 'study', name: '学习计划', version: 1, privateOnly: true, layout: { span: 12, minWidth: 340 },
  description: '一张复习进度表：每个主题标出掌握到哪一级、还差什么，下面是按顺序读的资料。可以直接粘贴 AI 给的表格。',
  defaultData: { title: '学习计划', topics: [], resources: [] },
};
const id = (value, seen) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value) || seen.has(value)) throw new Error('条目编号无效。');
  seen.add(value); return value;
};
export function validate(data = {}) {
  if (!data || !Array.isArray(data.topics) || data.topics.length > 60) throw new Error('学习计划最多 60 个主题。');
  if (!Array.isArray(data.resources) || data.resources.length > 30) throw new Error('学习资料最多 30 条。');
  const seen = new Set();
  const topics = data.topics.map(topic => {
    if (!topic || !Number.isInteger(topic.level) || topic.level < 0 || topic.level >= LEVELS.length) throw new Error('请选择掌握程度。');
    const name = text(topic.name, 80, '主题');
    if (!name) throw new Error('主题不能为空。');
    return { id: id(topic.id, seen), name, level: topic.level, star: topic.star === true, note: text(topic.note, 120, '现状说明'), gap: text(topic.gap, 300, '要补的内容') };
  });
  const resources = data.resources.map(resource => {
    const title = text(resource?.title, 160, '资料名称');
    if (!title) throw new Error('资料名称不能为空。');
    return { id: id(resource.id, seen), title, note: text(resource.note, 300, '资料说明'), url: safeLink(resource.url), done: resource.done === true };
  });
  return { title: text(data.title, 100, '标题'), topics, resources };
}
