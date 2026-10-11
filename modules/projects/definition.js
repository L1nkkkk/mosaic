import { text, safeLink } from '../../web/ui.js';

export const STAGES = [['idea', '构思'], ['building', '开发中'], ['polishing', '打磨'], ['shipped', '已发布']];
export const ACCENTS = [['cyan', '青'], ['amber', '琥珀'], ['magenta', '洋红'], ['lime', '青柠'], ['blue', '蓝'], ['coral', '珊瑚']];

export const meta = {
  id: 'projects', name: '项目进度', version: 1, description: '在工作台推进里程碑，公开页展示阶段与进度；内部备注和标记为不公开的里程碑只留在私人空间。',
  layout: { span: 8, minWidth: 300 },
  defaultData: { title: '在做的项目', projects: [{ id: 'first', name: '一个新项目', summary: '用一句话说明它是什么。', url: '', stage: 'idea', accent: 'cyan', paused: false, note: '', milestones: [{ text: '写下第一个里程碑', done: false }] }] },
};

export function validate(data = {}) {
  if (!data || !Array.isArray(data.projects) || data.projects.length > 8) throw new Error('项目最多 8 个。');
  const seen = new Set();
  const projects = data.projects.map(project => {
    if (!project || typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(project.id) || seen.has(project.id)) throw new Error('项目编号无效或重复。');
    seen.add(project.id);
    const name = text(project.name, 60, '项目名称');
    if (!name) throw new Error('项目名称不能为空。');
    if (!STAGES.some(([id]) => id === project.stage)) throw new Error('项目阶段无效。');
    if (!ACCENTS.some(([id]) => id === project.accent)) throw new Error('项目颜色无效。');
    if (!Array.isArray(project.milestones) || project.milestones.length > 24) throw new Error('每个项目最多 24 个里程碑。');
    const milestones = project.milestones.map(item => {
      const value = text(item?.text, 120, '里程碑');
      if (!value || typeof item.done !== 'boolean') throw new Error('里程碑格式无效。');
      return { text: value, done: item.done, ...(item.private === true ? { private: true } : {}) };
    });
    return { id: project.id, name, summary: text(project.summary, 200, '简介'), url: safeLink(project.url ?? ''), stage: project.stage, accent: project.accent, paused: project.paused === true, note: text(project.note, 1000, '内部备注'), milestones };
  });
  return { title: text(data.title, 100, '标题'), projects };
}

// Visitors get the stage, the overall count and only the milestones meant for
// them. Notes and private milestone text stay on the server.
export function publicData(data) {
  return { title: data.title, projects: data.projects.map(({ note, milestones, ...project }) => ({
    ...project, note: '',
    progress: { done: milestones.filter(item => item.done).length, total: milestones.length },
    milestones: milestones.filter(item => !item.private).map(item => ({ text: item.text, done: item.done })),
  })) };
}
