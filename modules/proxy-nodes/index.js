import { escape, field, fields, text } from '../../web/ui.js';

export const meta = {
  id: 'proxy-nodes', name: '代理节点', version: 1, privateOnly: true,
  description: '节点出口 IP、地区、延迟与 IP 变化记录。',
  layout: { span: 12, minWidth: 320 }, defaultData: { title: '代理节点' },
};
export function validate(data = {}) { return { title: text(data.title, 100, '标题', '代理节点') }; }
export function edit({ data, change }) {
  return fields(field('标题', data.title, value => change({ ...data, title: value }), { maxLength: 100 }));
}
export async function load({ request }) { return request('private/proxies'); }

function date(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}
function duration(start, end) {
  const hours = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 3600000));
  return !Number.isFinite(hours) ? '—' : hours >= 24 ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : hours ? `${hours} 小时` : '不足 1 小时';
}
function expired(at) { return !at || !Number.isFinite(Date.parse(at)) || Date.now() - Date.parse(at) > 20 * 60000 || Date.parse(at) > Date.now() + 10000; }
function light(color, label) { return `<span class="pn-light pn-${color}"><i aria-hidden="true"></i>${escape(label)}</span>`; }
function place(node) {
  let country = node.country;
  if (node.countryCode) {
    try { country = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(node.countryCode); } catch { /* Keep provider label. */ }
  }
  return [country, node.region, node.city].filter((value, i, all) => value && all.indexOf(value) === i).join(' · ') || '地区待查询';
}

export function render(data, resource = {}) {
  const snapshot = resource.value;
  const stale = snapshot?.stale || expired(snapshot?.collectedAt);
  const heading = `<header class="pn-heading"><h2>${escape(data.title)}</h2>${light(resource.error || stale ? 'gray' : 'green', resource.error ? '读取失败' : !snapshot?.available ? '等待采集' : stale ? '数据过期' : '已更新')}</header>`;
  if (!snapshot?.available) return `<article class="proxy-nodes">${heading}<p class="pn-empty">${resource.error ? '暂时无法读取节点状态。' : '等待第一次节点探测。'}</p></article>`;
  const groups = snapshot.groups || [];
  const chosen = new Set(groups.map(group => group.selected));
  const nodes = [...(snapshot.nodes || [])].sort((a, b) => Number(chosen.has(b.name)) - Number(chosen.has(a.name)) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  const freshCount = nodes.filter(node => !stale && !expired(node.checkedAt) && node.reachable === true).length;
  const selections = groups.map(group => `<span>${escape(group.name === 'X-AUTO' ? 'X' : group.name === 'DOUYIN-AUTO' ? '抖音' : group.name)} <strong>${escape(group.selected || '未知')}</strong></span>`).join('');
  const rows = nodes.map(node => {
    const old = stale || expired(node.checkedAt);
    const healthColor = old || node.reachable === null ? 'gray' : node.reachable ? 'green' : 'red';
    const healthLabel = old ? '状态过期' : node.reachable === null ? '待检测' : node.reachable ? '出口可达' : '出口探测失败';
    const delay = !old && !expired(node.delayAt) && typeof node.delayMs === 'number' && node.delayMs > 0 ? node.delayMs : null;
    const delayColor = delay === null ? 'gray' : delay < 300 ? 'green' : delay < 800 ? 'amber' : 'red';
    const changes = node.changes || 0;
    const stableColor = changes ? 'amber' : node.samples >= 2 ? 'blue' : 'gray';
    const stableLabel = changes ? '曾变化' : node.samples >= 2 ? '暂未变化' : '尚待观察';
    return `<div class="pn-row" role="row">
      <div role="cell" class="pn-node"><strong>${escape(node.name)}</strong>${light(healthColor, healthLabel)}${chosen.has(node.name) ? '<span class="pn-selected">选中</span>' : ''}</div>
      <div role="cell" class="pn-ip"><span class="pn-mobile-label">出口 IP</span><code>${escape(node.ip || '—')}</code>${node.ip && (old || !node.reachable) ? '<small>上次成功结果</small>' : ''}</div>
      <div role="cell" class="pn-place"><span class="pn-mobile-label">地区 / 运营商</span><span>${escape(place(node))}</span><small>${escape(node.isp || '运营商未知')}</small></div>
      <div role="cell" class="pn-delay"><span class="pn-mobile-label">延迟</span>${light(delayColor, delay === null ? '未测得' : `${Math.round(delay)} ms`)}</div>
      <div role="cell" class="pn-stability"><span class="pn-mobile-label">IP 稳定性</span>${light(stableColor, stableLabel)}<small>静态 IP 未确认</small><details><summary>${escape(String(node.samples || 0))} 次观测 · ${escape(String(changes))} 次变化</summary><p>连续未变：${escape(duration(node.stableSince, node.lastSeen))}<br>开始观测：${escape(date(node.firstSeen))}<br>上次成功：${escape(date(node.lastSeen))}<br>本轮探测：${escape(date(node.checkedAt))}</p></details></div>
    </div>`;
  }).join('');
  return `<article class="proxy-nodes">${heading}<div class="pn-summary"><span>${nodes.length} 个节点${stale ? '' : ` · ${freshCount} 个出口可达`}</span>${selections}</div>
    <div class="pn-table" role="table" aria-label="节点出口与状态"><div class="pn-columns" role="row"><span role="columnheader">节点</span><span role="columnheader">出口 IP</span><span role="columnheader">地区 / 运营商</span><span role="columnheader">延迟</span><span role="columnheader">IP 稳定性</span></div>${rows || '<p class="pn-empty">暂无节点</p>'}</div>
    <footer class="pn-foot"><span>出口约每 15 分钟检测 · ${escape(date(snapshot.collectedAt))}</span><p>延迟：绿 &lt;300 ms，黄 300–799 ms，红 ≥800 ms；灰色为未知或过期。蓝灯表示观测期间暂未变化，黄灯表示曾变化，均不能证明是否为静态 IP；静态性需供应商确认。</p><p>IP 来源：ipwho.is / ipify；地区为 IP 数据库估算。出口可能随目标网站而不同，延迟取 Mihomo 最近一次探测。</p></footer></article>`;
}
