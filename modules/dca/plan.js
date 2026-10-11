// Shared by the server definition, the data route and the client. No DOM access here.
export const EVERY = { week: '每周', month: '每月' };
// The parts of a row an instance may show; with none of them a row is just the name, the return and the signal.
export const PARTS = { tags: '类别标签', horizons: '定投时长对比', chart: '走势图', note: '文字说明', averages: '各时段均价' };
const SYMBOL = /^(fund:\d{6}|quote:\d{1,3}\.[A-Za-z0-9]{1,12})$/;

export function symbol(value) {
  if (typeof value !== 'string' || !SYMBOL.test(value)) throw Object.assign(new Error('请从搜索结果里选择标的。'), { status: 400 });
  return value;
}
export function startDate(value) {
  const time = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value || value < '1990-01-01') throw Object.assign(new Error('起点日期需要是有效的日期。'), { status: 400 });
  return value;
}
export function every(value) {
  if (!Object.hasOwn(EVERY, value)) throw Object.assign(new Error('定投频率只能是每周或每月。'), { status: 400 });
  return value;
}
export const planKey = plan => `${plan.symbol}|${plan.start}|${plan.every}`;
