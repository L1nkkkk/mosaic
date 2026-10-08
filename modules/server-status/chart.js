import { bytes, duration } from '../status-ui.js';
const windows = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };
const rate = value => value >= 1048576 ? `${(value / 1048576).toFixed(2)} MB/s` : `${(value / 1024).toFixed(1)} KB/s`;
const time = value => new Date(value * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const svgElement = (tag, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };

export function mountStatusHistory(context, render) {
  const holder = document.createElement('div'); holder.innerHTML = render(context.data, context.resource);
  const card = holder.firstElementChild;
  const monitor = document.createElement('div'); monitor.className = 'server-monitor';
  const summary = card.querySelector('.server-metrics');
  summary.innerHTML = ['cpu', 'memory', 'network'].map((key, i) => `<button type="button" class="server-summary" data-metric="${key}" aria-pressed="${i === 0}"><svg class="server-spark" viewBox="0 0 90 48" aria-hidden="true"></svg><span class="server-summary-text"><span>${['CPU', '内存', '网络'][i]}</span><strong>—</strong><small>${['使用率', '已用 / 总量', '↓ 接收　↑ 发送'][i]}</small></span></button>`).join('');
  const storage = document.createElement('p'); storage.className = 'server-storage';
  const summaryColumn = document.createElement('div'); summaryColumn.className = 'server-summary-column';
  const miniLabel = document.createElement('p'); miniLabel.className = 'server-mini-label'; miniLabel.textContent = '最近 1 小时 · 实时';
  card.insertBefore(monitor, summary); summaryColumn.append(summary, miniLabel, storage); monitor.append(summaryColumn);
  const section = document.createElement('section'); section.className = 'server-history';
  section.innerHTML = `<div class="history-controls"><h3 class="history-title">CPU</h3><label>范围 <select aria-label="历史时间范围"><option value="1h">最近 1 小时</option><option value="6h">最近 6 小时</option><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option></select></label></div><div class="history-navigation"><button type="button" data-history="older" aria-label="上一时间段">←</button><button type="button" data-history="live">暂停实时</button><button type="button" data-history="newer" aria-label="下一时间段" disabled>→</button><span class="history-mode">实时</span></div><div class="history-plot" tabindex="0" aria-label="历史趋势，左右方向键查看数据点"></div><p class="history-detail" aria-live="polite"></p><p class="history-message" role="status">正在读取历史…</p>`;
  monitor.append(section); context.root.append(card);
  const plot = section.querySelector('.history-plot'), detail = section.querySelector('.history-detail'), message = section.querySelector('.history-message');
  const svg = svgElement('svg', { viewBox: '0 0 640 190', role: 'img', 'aria-label': '服务器历史趋势' });
  plot.append(svg);
  const group = svgElement('g'), axes = svgElement('g'); svg.append(axes, group);
  let range = '1h', metric = 'cpu', fixedEnd = null, active = false, disposed = false, generation = 0, history = null, points = [], pending = true, inspecting = -1;
  let inFlight = null, lastSnapshot, overview = null, overviewFlight = null;
  const button = name => section.querySelector(`[data-history="${name}"]`);
  const format = (value, key) => value === null || value === undefined ? '—' : key === 'rx' || key === 'tx' ? rate(value) : `${value.toFixed(1)}%`;
  function drawOverview() {
    if (!active || disposed || !overview) return;
    for (const row of summary.querySelectorAll('[data-metric]')) {
      const mini = row.querySelector('svg'), keys = row.dataset.metric === 'network' ? ['rx', 'tx'] : [row.dataset.metric];
      mini.replaceChildren(svgElement('path', { d: 'M0,16H90 M0,32H90 M30,0V48 M60,0V48', class: 'history-grid', fill: 'none' }));
      const ceiling = row.dataset.metric === 'network' ? Math.max(1, ...overview.points.flatMap(point => keys.map(key => point[key]?.max || 0))) * 1.1 : 100;
      keys.forEach((key, index) => {
        let path = '', previous;
        for (const point of overview.points) {
          const value = point[key]?.avg;
          if (value === null || value === undefined) { previous = null; continue; }
          const x = Math.max(1, Math.min(89, 1 + (point.t - overview.start) / (overview.end - overview.start) * 88)), y = 46 - Math.min(1, value / ceiling) * 44;
          const connected = previous && !point.gap && !previous.gap && point.t - previous.t <= 90;
          path += `${connected ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
          if (!connected) mini.append(svgElement('circle', { cx: x, cy: y, r: 1.5, class: `history-line series-${index}` }));
          previous = point;
        }
        mini.append(svgElement('path', { d: path, fill: 'none', class: `history-line series-${index}` }));
      });
    }
    miniLabel.textContent = `最近 1 小时 · ${!overview.lastCollectedAt || Date.now()/1000 - overview.lastCollectedAt > 90 ? '采集已过期' : '实时'}`;
  }
  function mergeOverview(next, reset = false) {
    if (!next.available) return;
    const merged = new Map((reset ? [] : overview?.points || []).map(point => [point.t, point]));
    for (const point of next.points) merged.set(point.t, point);
    overview = { ...next, points: [...merged.values()].filter(point => point.t >= next.start).sort((a,b) => a.t-b.t) };
    drawOverview();
  }
  async function refreshOverview() {
    if (!active || disposed || overviewFlight) return;
    if (range === '1h' && fixedEnd === null) return; // The detail request supplies the same data.
    const last = overview?.points.at(-1)?.t;
    try {
      overviewFlight = context.request(`private/history?range=1h${last ? `&since=${last}` : ''}`);
      const next = await overviewFlight;
      if (!disposed) mergeOverview(next);
    } catch { miniLabel.textContent = '最近 1 小时 · 更新暂时失败'; }
    finally { overviewFlight = null; }
  }
  function controls() {
    button('live').textContent = fixedEnd === null ? '暂停实时' : '回到实时';
    button('newer').disabled = fixedEnd === null;
    button('older').disabled = !history?.retainedFrom || history.start <= history.retainedFrom;
    section.querySelector('.history-mode').textContent = fixedEnd === null ? '实时 · 约 30 秒更新' : '历史 · 保持当前区间';
  }
  function inspect(index) {
    if (!points.length) return;
    inspecting = Math.max(0, Math.min(points.length - 1, index));
    const point = points[inspecting];
    const keys = metric === 'network' ? ['rx', 'tx'] : [metric];
    const names = { cpu: 'CPU', memory: '内存', rx: '↓ 接收', tx: '↑ 发送' };
    detail.textContent = `${time(point.t)} · ${keys.map(key => `${names[key]} ${format(point[key]?.avg, key)}（峰值 ${format(point[key]?.max, key)}）`).join(' · ')}${point.gap ? ' · 采集有缺口' : ''}`;
  }
  function draw() {
    if (!active || disposed || !history) return;
    group.replaceChildren(); axes.replaceChildren();
    const width = Math.max(260, plot.clientWidth), innerWidth = width - 64, right = width - 18;
    svg.setAttribute('viewBox', `0 0 ${width} 190`);
    const keys = metric === 'network' ? ['rx', 'tx'] : [metric];
    const peak = Math.max(1, ...points.flatMap(point => keys.map(key => point[key]?.max || 0)));
    const ceiling = metric === 'network' ? peak * 1.1 : 100;
    const x = t => 46 + Math.max(0, Math.min(1, (t - history.start) / (history.end - history.start))) * innerWidth;
    const y = v => 150 - Math.min(1, v / ceiling) * 130;
    for (const fraction of [0, .5, 1]) {
      axes.append(svgElement('line', { x1: 46, x2: right, y1: y(ceiling * fraction), y2: y(ceiling * fraction), class: 'history-grid' }));
      const text = svgElement('text', { x: 42, y: y(ceiling * fraction) + 4, 'text-anchor': 'end' });
      text.textContent = metric === 'network' ? `${(ceiling * fraction / 1024).toFixed(0)}K` : `${fraction * 100}%`; axes.append(text);
    }
    for (const [t, anchor] of [[history.start, 'start'], [history.end, 'end']]) {
      const text = svgElement('text', { x: x(t), y: 179, 'text-anchor': anchor }); text.textContent = time(t); axes.append(text);
    }
    keys.forEach((key, index) => {
      let path = '', previous;
      for (const point of points) {
        const value = point[key];
        if (!value || value.avg === null) { previous = null; continue; }
        const connected = previous && !point.gap && !previous.gap && point.t - previous.t <= Math.max(90, history.step * 1.5);
        path += `${connected ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(value.avg).toFixed(1)} `;
        if (!connected || points.length === 1) group.append(svgElement('circle', { cx: x(point.t), cy: y(value.avg), r: 2.5, class: `history-line series-${index}` }));
        // A fine range bar preserves spikes that the average would hide.
        if (value.max > value.min) group.append(svgElement('line', { x1: x(point.t), x2: x(point.t), y1: y(value.min), y2: y(value.max), class: `history-peak series-${index}` }));
        previous = point;
      }
      group.append(svgElement('path', { d: path, class: `history-line series-${index}`, fill: 'none' }));
    });
    svg.setAttribute('aria-label', `${metric === 'network' ? '网络接收（紫）与发送（绿），单位 KB/s' : metric === 'cpu' ? 'CPU 使用率' : '内存使用率'}，${points.length} 个采集点`);
    if (points.length) inspect(inspecting < 0 ? points.length - 1 : inspecting);
    else detail.textContent = '这个区间暂无记录；历史从启用采集后开始积累。';
    controls();
  }
  async function refresh(reset = false) {
    if (!active || disposed) { pending = true; return; }
    if (fixedEnd !== null && !reset) return;
    const token = ++generation;
    const params = new URLSearchParams({ range });
    if (fixedEnd !== null) params.set('end', String(fixedEnd));
    if (!reset && points.length && history?.range === range) params.set('since', String(points.at(-1).t));
    pending = false; message.textContent = '正在更新…';
    const operation = context.request(`private/history?${params}`); inFlight = operation;
    try {
      const next = await operation;
      if (disposed || token !== generation) return;
      if (!next.available) throw new Error('历史暂时不可用，等待服务器采集。');
      const merged = new Map((reset ? [] : points).map(point => [point.t, point]));
      for (const point of next.points) merged.set(point.t, point);
      points = [...merged.values()].filter(point => point.t >= Math.floor(next.start / next.step) * next.step && point.t <= next.end).sort((a, b) => a.t - b.t);
      history = next;
      if (range === '1h' && fixedEnd === null) mergeOverview(next, reset);
      const stale = !next.lastCollectedAt || Date.now() / 1000 - next.lastCollectedAt > 90;
      message.textContent = `${stale ? '采集已过期 · ' : ''}${metric === 'network' ? '紫色接收 · 绿色发送 · ' : ''}${next.step === 30 ? '原始采样' : `${next.step / 60} 分钟平均 / 峰值`} · 缺失数据不连线`;
      draw();
    } catch (error) { if (!disposed && token === generation) message.textContent = `${error.message} 已有曲线保留。`; }
    finally { if (inFlight === operation) inFlight = null; }
  }
  function reset() { generation++; points = []; inspecting = -1; history = null; group.replaceChildren(); axes.replaceChildren(); detail.textContent = ''; void refresh(true); controls(); }
  section.querySelector('[aria-label="历史时间范围"]').onchange = event => { range = event.target.value; reset(); };
  for (const row of summary.querySelectorAll('[data-metric]')) row.onclick = () => {
    metric = row.dataset.metric; inspecting = -1;
    for (const other of summary.querySelectorAll('[data-metric]')) other.setAttribute('aria-pressed', String(other === row));
    section.querySelector('.history-title').textContent = { cpu: 'CPU', memory: '内存', network: '网络收发' }[metric];
    draw();
    if (history) message.textContent = `${!history.lastCollectedAt || Date.now()/1000-history.lastCollectedAt>90 ? '采集已过期 · ' : ''}${metric === 'network' ? '紫色接收 · 绿色发送 · ' : ''}${history.step / 60} 分钟采样 / 汇总 · 缺失数据不连线`;
  };
  button('live').onclick = () => { if (fixedEnd === null) { fixedEnd = history?.end || Math.floor(Date.now() / 1000); generation++; controls(); } else { fixedEnd = null; reset(); } };
  button('older').onclick = () => { fixedEnd = (fixedEnd ?? history?.end ?? Math.floor(Date.now() / 1000)) - windows[range]; reset(); };
  button('newer').onclick = () => { fixedEnd += windows[range]; if (fixedEnd >= Date.now() / 1000 - 30) fixedEnd = null; reset(); };
  plot.onpointermove = event => {
    if (!history || !points.length) return;
    const rect = svg.getBoundingClientRect(), t = history.start + Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * svg.viewBox.baseVal.width - 46) / (svg.viewBox.baseVal.width - 64))) * (history.end - history.start);
    inspect(points.reduce((best, point, index) => Math.abs(point.t - t) < Math.abs(points[best].t - t) ? index : best, 0));
  };
  plot.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); inspect((inspecting < 0 ? points.length - 1 : inspecting) + (event.key === 'ArrowLeft' ? -1 : 1)); } };
  return {
    update(data, resource) {
      holder.innerHTML = render(data, resource);
      for (const selector of ['.status-heading', '.status-foot']) card.querySelector(selector).innerHTML = holder.querySelector(selector).innerHTML;
      summary.classList.toggle('stale-metrics', holder.querySelector('.server-metrics').classList.contains('stale-metrics'));
      const server = resource?.value?.server;
      summary.querySelector('[data-metric="cpu"] strong').textContent = format(server?.cpuPercent, 'cpu');
      summary.querySelector('[data-metric="cpu"] small').textContent = `${server?.cpuCount ?? '—'} 核心`;
      summary.querySelector('[data-metric="memory"] strong').textContent = server?.memory?.total && typeof server.memory.used === 'number' ? format(server.memory.used / server.memory.total * 100, 'memory') : '—';
      summary.querySelector('[data-metric="memory"] small').textContent = `${bytes(server?.memory?.used)} / ${bytes(server?.memory?.total)}`;
      summary.querySelector('[data-metric="network"] strong').textContent = `↓ ${format(server?.network?.rxBytesPerSecond, 'rx')}`;
      summary.querySelector('[data-metric="network"] small').textContent = `↑ ${format(server?.network?.txBytesPerSecond, 'tx')}`;
      storage.textContent = `可用磁盘 ${bytes(server?.disk?.available)} · 运行 ${duration(server?.uptimeSeconds)}`;
      const timestamp = resource?.value?.collectedAt;
      if (timestamp !== lastSnapshot || resource?.error) { lastSnapshot = timestamp; pending = true; if (!inFlight) void refresh(); void refreshOverview(); }
    },
    setActive(value) { active = value; if (active) { draw(); drawOverview(); if (pending || !history) void refresh(!history); void refreshOverview(); } },
    resize() { draw(); },
    dispose() { disposed = true; generation++; },
  };
}
