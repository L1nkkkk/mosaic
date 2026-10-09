import { createModuleHost } from './runtime.js';
import { escape } from './ui.js';

function simulatedResource(type) {
  const now = new Date().toISOString();
  if (type === 'proxy-nodes') return { value: { available: true, stale: false, collectedAt: now, groups: [], nodes: [{ name: '示例节点', ip: '192.0.2.1', countryCode: 'JP', delayMs: 120, delayAt: now, checkedAt: now, reachable: true, samples: 3, changes: 0 }] } };
  return { value: { available: true, stale: false, collectedAt: now, server: { cpuPercent: 12.5, cpuCount: 4, memory: { used: 1073741824, total: 4294967296 }, disk: { available: 21474836480, total: 42949672960 }, uptimeSeconds: 86400 }, bot: { astrbot: { running: true, uptimeSeconds: 86400, restarts: 0 }, napcat: { running: true }, qqOnline: true, onebotConnected: true, webuiReachable: true } } };
}

export async function openLab({ app, catalog, definitions, request }) {
  document.title = '模块实验台 · Mosaic';
  app.innerHTML = `<div class="lab-shell"><header class="site-header"><a class="brand" href="private">Mosaic · 模块实验台</a><a class="button outline small" href="edit">返回编辑台</a></header><main id="main" class="lab-layout"><aside class="lab-controls">
    <p class="scope-help">内容仅在本次实验中保留，不会写入网站。刷新后重置。</p>
    <label class="field"><span>模块</span><select id="lab-module">${catalog.map(meta => `<option value="${meta.id}">${escape(meta.name)}</option>`).join('')}</select></label>
    <label class="field"><span>宽度（像素）</span><input id="lab-width" type="number" min="160" max="1800" value="640"></label>
    <label class="field"><span>高度（像素）</span><input id="lab-height" type="number" min="120" max="1600" value="440"></label>
    <label class="field"><span>外观</span><select id="lab-appearance"><option value="card">默认</option><option value="bare">无边框</option></select></label>
    <label class="field"><span>数据来源</span><select id="lab-resource"><option value="simulated">模拟成功</option><option value="error">模拟失败</option><option value="empty">无数据</option><option value="live">读取真实数据（需登录）</option></select></label>
    <label class="lab-check"><input id="lab-writable" type="checkbox" checked>允许交互保存到实验草稿</label>
    <label class="lab-check"><input id="lab-paused" type="checkbox">暂停动画</label>
    <button class="button outline small" id="lab-remount">重新挂载</button>
    <h2>内容</h2><div id="lab-fields"></div>
    <details><summary>数据 JSON</summary><textarea id="lab-json" rows="10" aria-label="模块数据 JSON" spellcheck="false"></textarea><button class="button outline small" id="lab-apply">应用数据</button></details>
    <p id="lab-message" role="status"></p>
    <h2>运行状态</h2><pre id="lab-state"></pre>
  </aside><section class="lab-stage" aria-label="独立模块预览"><div class="module-slot" id="lab-slot"><div class="module-frame has-fixed-size"><div class="module-content"></div></div></div></section></main></div>`;
  const $ = selector => app.querySelector(selector);
  let host, module, data, resource, generation = 0, revision = 0;
  const content = $('.module-content');
  function report(message) { $('#lab-message').textContent = message; }
  function options() {
    return { id: 'lab-instance', view: 'lab', appearance: $('#lab-appearance').value, data, resource, writable: $('#lab-writable').checked,
      request: route => {
        if ($('#lab-resource').value !== 'live') return Promise.reject(new Error('实验台当前使用模拟数据。'));
        return request(route);
      },
      async save(next) {
        data = module.validate ? module.validate(next) : structuredClone(next);
        revision++; update(); fields(); report('已更新实验草稿；网站内容未改变。'); return structuredClone(data);
      }, onError: error => report(`模块错误：${error.message}`),
    };
  }
  function update() {
    host?.update(options());
    $('#lab-json').value = JSON.stringify(data, null, 2);
  }
  function fields() {
    $('#lab-fields').replaceChildren();
    try { $('#lab-fields').append(module.edit({ data: structuredClone(data), change(next, refresh) { data = { ...data, ...next }; update(); if (refresh) fields(); } })); }
    catch (error) { report(`编辑器错误：${error.message}`); }
  }
  async function loadResource() {
    const token = ++generation, mode = $('#lab-resource').value;
    if (mode === 'error') resource = { error: '模拟：状态暂时无法读取' };
    else if (mode === 'empty') resource = undefined;
    else if (mode === 'simulated') resource = simulatedResource(module.meta.id);
    else {
      try { const value = module.load ? await module.load({ id: 'lab-instance', data: structuredClone(data), request }) : undefined; if (token !== generation) return; resource = { value }; }
      catch (error) { if (token !== generation) return; resource = { error: error.message }; }
    }
    update();
  }
  function remount() { if (!module) return; host?.dispose(); host = createModuleHost(content, module, options()); host.pause($('#lab-paused').checked); }
  function choose() {
    generation++; host?.dispose(); host = undefined;
    module = definitions.get($('#lab-module').value);
    if (!module) { report('模块未能加载，请检查 client.js。'); return; }
    data = structuredClone(module.meta.defaultData); resource = undefined; revision = 0;
    report(''); remount(); fields(); loadResource();
  }
  function resize() {
    if (!$('#lab-width').checkValidity() || !$('#lab-height').checkValidity()) return;
    $('#lab-slot').style.width = `${$('#lab-width').value}px`;
    $('.module-frame').style.height = `${$('#lab-height').value}px`;
  }
  $('#lab-module').value = catalog.some(meta => meta.id === 'todo') ? 'todo' : catalog[0].id;
  $('#lab-module').onchange = choose;
  $('#lab-width').oninput = $('#lab-height').oninput = resize;
  $('#lab-appearance').onchange = () => { $('#lab-slot').dataset.appearance = $('#lab-appearance').value; update(); };
  $('#lab-resource').onchange = loadResource;
  $('#lab-writable').onchange = update;
  $('#lab-paused').onchange = () => host?.pause($('#lab-paused').checked);
  $('#lab-remount').onclick = remount;
  $('#lab-apply').onclick = () => {
    try { const next = JSON.parse($('#lab-json').value); data = module.validate ? module.validate(next) : next; update(); fields(); report('已应用数据。'); }
    catch (error) { report(error.message); }
  };
  resize(); choose();
  const timer = setInterval(() => { $('#lab-state').textContent = JSON.stringify({ ...host?.inspect(), experimentalSaves: revision }, null, 2); }, 500);
  window.addEventListener('pagehide', () => { clearInterval(timer); generation++; host?.dispose(); }, { once: true });
}
