import { text } from '../../web/ui.js';
import { symbol, startDate, every, PARTS } from './plan.js';
export const meta = { id: 'dca', name: '定投信号', version: 1, privateOnly: true, layout: { span: 6, minWidth: 320 }, description: '假设从某天起定期定额买入，收益跌到 0 以下时提示适合入场。', defaultData: { title: '定投信号', show: Object.keys(PARTS), plans: [] } };
export function validate(data = {}) {
  if (!Array.isArray(data.plans) || data.plans.length > 8) throw new Error('定投信号最多跟踪 8 个标的。');
  const ids = new Set();
  const plans = data.plans.map(plan => {
    const id = text(plan?.id, 24, '标的编号');
    if (!/^[a-z0-9]{1,24}$/.test(id) || ids.has(id)) throw new Error('标的编号无效。');
    ids.add(id);
    const name = text(plan.name, 60, '标的名称');
    if (!name) throw new Error('请从搜索结果里选择标的。');
    return { id, symbol: symbol(plan.symbol), name, kind: text(plan.kind, 12, '标的类别'), start: startDate(plan.start), every: every(plan.every) };
  });
  const show = data.show === undefined ? Object.keys(PARTS) : data.show;
  if (!Array.isArray(show) || show.some(part => !Object.hasOwn(PARTS, part))) throw new Error('显示内容包含未知的部分。');
  return { title: text(data.title, 100, '标题'), show: Object.keys(PARTS).filter(part => show.includes(part)), plans };
}
