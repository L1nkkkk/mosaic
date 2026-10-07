import { escape, field, fields } from '../web/ui.js';

export function bytes(value) {
  if (typeof value !== 'number') return '—';
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;
}
export function duration(value) {
  if (typeof value !== 'number') return '—';
  return value >= 86400 ? `${Math.floor(value / 86400)} 天` : value >= 3600 ? `${Math.floor(value / 3600)} 小时` : `${Math.floor(value / 60)} 分钟`;
}
export function statusFrame({ kind, title, resource = {}, content }) {
  const snapshot = resource.value;
  const stale = !snapshot?.available || snapshot.stale || Date.now() - Date.parse(snapshot.collectedAt) > 90_000;
  const label = resource.error ? '读取失败' : !snapshot?.available ? '等待采集' : stale ? '数据已过期' : '状态已更新';
  const time = snapshot?.collectedAt ? new Date(snapshot.collectedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '暂无';
  return `<article class="${kind}-module status-module"><div class="status-heading"><div><div class="eyebrow">PRIVATE / 仅自己可见</div><h2>${escape(title)}</h2></div><span class="status-freshness ${stale ? 'stale' : ''}">${label}</span></div>${content(snapshot, stale)}<div class="status-foot"><span>${stale ? '当前状态待确认，请勿将旧数据视为实时结果。' : '约每 30 秒自动采集'}</span><span>采集于 ${escape(time)}</span></div></article>`;
}
export function statusEditor({ data, change }) {
  const wrapper = fields(field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }));
  const note = document.createElement('p'); note.className = 'muted';
  note.textContent = '状态由服务器自动采集，此模块固定为 Private。这里不保存登录凭据或聊天内容。';
  wrapper.append(note);
  return wrapper;
}
export function indicator(label, value, stale) {
  const status = stale || value === null || value === undefined ? 'unknown' : value ? 'good' : 'bad';
  const text = status === 'unknown' ? '待确认' : status === 'good' ? '正常' : '异常';
  return `<div class="status-indicator"><span>${escape(label)}</span><strong class="${status}"><i></i>${text}</strong></div>`;
}
