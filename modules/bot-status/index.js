import { text } from '../../web/ui.js';
import { duration, statusFrame, statusEditor, indicator } from '../status-ui.js';

export const meta = { id: 'bot-status', name: 'Bot 状态', version: 1, layout: { span: 6, minWidth: 280 }, privateOnly: true, description: '查看 AstrBot、QQ 登录与消息连接，仅自己可见。', defaultData: { title: 'Bot 的运行状态。' } };
export function validate(data = {}) { return { title: text(data.title, 100, '标题') }; }
export async function load({ request }) { return request('private/status'); }
export const edit = statusEditor;
export function render(data, resource = {}) {
  return statusFrame({ kind: 'bot-status', title: data.title, resource, content(snapshot, stale) {
    const bot = snapshot?.bot;
    return `<div class="bot-indicators">${indicator('AstrBot 进程', bot?.astrbot?.running, stale)}${indicator('NapCat 进程', bot?.napcat?.running, stale)}${indicator('QQ 登录', bot?.qqOnline, stale)}${indicator('消息连接', bot?.onebotConnected, stale)}${indicator('管理界面', bot?.webuiReachable, stale)}</div><p class="bot-runtime">AstrBot 已运行 ${duration(bot?.astrbot?.uptimeSeconds)} · 重启 ${bot?.astrbot?.restarts ?? '—'} 次</p>`;
  } });
}
