import { escape, text } from '../../web/ui.js';
import { bytes, duration, statusFrame, statusEditor } from '../status-ui.js';

export const meta = { id: 'server-status', name: '服务器状态', version: 1, layout: { span: 6, minWidth: 300 }, privateOnly: true, description: '查看 CPU、内存、磁盘与运行时间，仅自己可见。', defaultData: { title: '服务器，运行得怎么样？' } };
export function validate(data = {}) { return { title: text(data.title, 100, '标题') }; }
export async function load({ request }) { return request('private/status'); }
export const edit = statusEditor;
export function render(data, resource = {}) {
  return statusFrame({ kind: 'server-status', title: data.title, resource, content(snapshot, stale) {
    const server = snapshot?.server;
    const memory = server?.memory;
    const disk = server?.disk;
    const metric = (label, value, caption) => `<div class="server-metric"><span>${label}</span><strong>${escape(value)}</strong><small>${escape(caption)}</small></div>`;
    return `<div class="server-metrics${stale ? ' stale-metrics' : ''}">${metric('CPU 使用率', typeof server?.cpuPercent === 'number' ? `${server.cpuPercent.toFixed(1)}%` : '—', `${server?.cpuCount ?? '—'} 核心`)}${metric('已用内存', bytes(memory?.used), `共 ${bytes(memory?.total)}`)}${metric('可用磁盘', bytes(disk?.available), `共 ${bytes(disk?.total)}`)}${metric('持续运行', duration(server?.uptimeSeconds), '服务器运行时间')}</div>`;
  } });
}
