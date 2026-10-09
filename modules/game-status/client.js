import { qrBinding } from './qr.js';
import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
export const load = ({ request }) => request('private/games');
export const edit = ({ data, change }) => fields(field('标题', data.title, title => change({ title }), { maxLength: 100 }));
const names = { genshin: '原神', arknights: '明日方舟', endfield: '终末地' };
const logos = { genshin: 'genshin-logo.png', arknights: 'arknights-logo.svg', endfield: 'endfield-logo.svg' };
// Mappings verified against the source pages/templates listed in assets/SOURCES.md.
const energyIcons = { genshin: 'genshin-resin.png', arknights: 'arknights-sanity.png', endfield: 'arknights-sanity.png' };
const metricIcons = {
  genshin: { '每日委托': 'genshin-task.png', '委托奖励': 'genshin-task.png', '洞天宝钱': 'genshin-home.png', '派遣完成': 'genshin-expedition.png' },
  arknights: { '每日任务': 'arknights-daily.png', '每周任务': 'arknights-weekly.png', '公开招募刷新': 'arknights-recruit.png' },
  endfield: { '每日活跃度': 'endfield-daily.png', '每周任务': 'arknights-weekly.png' },
};
function asset(filename, className = 'games-resource-icon') {
  const img = document.createElement('img'); img.className = className; img.alt = ''; img.decoding = 'async';
  img.src = new URL('./assets/' + filename, import.meta.url).href;
  img.addEventListener('error', () => { img.hidden = true; }, { once: true });
  return img;
}
const el = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls || ''; if (text !== undefined) node.textContent = text; return node; };
const date = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : '—';
function recovery(game) {
  if (!game.energy) return '';
  if (game.stale) return '上次成功数据 · 等待重新同步';
  if (game.energy.current >= game.energy.max) return '已回满';
  if (!game.energy.fullAt) return '回满时间未知';
  const minutes = Math.ceil((game.energy.fullAt - Date.now()) / 60000);
  if (minutes <= 0) return '预计已回满 · 待同步确认';
  return `预计 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分后回满`;
}
export function mount(context) {
  const card = el('article', 'games-module'), header = el('header', 'games-header'), title = el('h2');
  const refresh = el('button', 'button outline', '刷新状态 ↻'); refresh.type = 'button';
  const intro = el('p', 'games-intro', '国服 · 每 5 分钟同步 · 仅自己可见');
  const grid = el('div', 'games-grid'), status = el('p', 'games-status'); status.setAttribute('role', 'status');
  header.append(title, refresh); card.append(header, intro, grid, status); context.root.append(card);
  let value, busy = false, alive = true;
  const rows = Object.entries(names).map(([game, name]) => {
    const row = el('section', 'games-game'); row.dataset.game = game;
    const top = el('div', 'games-top'), brand = el('div', 'games-brand'), logo = el('img', 'games-logo'), label = el('h3', 'games-name', name), badge = el('span', 'games-badge');
    logo.src = new URL('./assets/' + logos[game], import.meta.url).href; logo.alt = ''; logo.decoding = 'async';
    logo.addEventListener('error', () => { logo.hidden = true; }, { signal: context.signal });
    brand.append(logo, label); top.append(brand, badge);
    if (game === 'arknights') row.append(asset('arknights-icon.svg', 'games-watermark'));
    if (game === 'endfield') row.append(asset('endfield-industries.svg', 'games-watermark'));
    const overline = el('div', 'games-overline', { genshin: '冒险手册', arknights: '罗德岛终端 / RHODES ISLAND', endfield: '协议终端 / ENDFIELD INDUSTRIES' }[game]);
    const player = el('p', 'games-player'), energy = el('div', 'games-energy'), energyArt = asset(energyIcons[game], 'games-resource-icon games-energy-icon'), energyBody = el('div', 'games-energy-body'), energyLabel = el('span', 'games-energy-label'), energyNumber = el('strong', 'games-energy-number'), progress = el('progress'), timer = el('p', 'games-timer'), metrics = el('dl', 'games-metrics'), updated = el('small', 'games-updated');
    progress.setAttribute('aria-label', `${name}体力进度`);
    energyBody.append(energyLabel, energyNumber); energy.append(energyArt, energyBody);
    row.append(overline, top, player, energy, progress, timer, metrics, updated); grid.append(row);
    return { game, row, badge, player, energy, energyLabel, energyNumber, progress, timer, metrics, updated };
  });
  function draw() {
    for (const ui of rows) {
      const game = value?.games?.find(item => item.game === ui.game) || { state: 'waiting' };
      const e = game.energy;
      ui.badge.textContent = game.stale ? '数据待更新' : ({ ready: '已同步', unbound: '未绑定', waiting: '等待同步', auth: '重新绑定', verification: '需要验证', restricted: '社区风险限制', missing: '未找到角色', unavailable: '连接异常' }[game.state] || '暂不可用');
      ui.row.dataset.state = game.stale ? 'stale' : game.state;
      ui.row.dataset.full = String(!!e && e.current >= e.max && !game.stale);
      ui.player.textContent = game.nickname ? `${game.nickname} · Lv.${number(game.level)}${game.server ? ' · ' + game.server : ''}` : '绑定后读取你的游戏状态';
      ui.energyLabel.textContent = e?.label || (ui.game === 'genshin' ? '原粹树脂' : ui.game === 'arknights' ? '理智' : '体力');
      ui.energyNumber.textContent = e ? `${number(e.current)} / ${number(e.max)}` : '— / —';
      ui.progress.max = e?.max || 1; ui.progress.value = Math.min(e?.current || 0, e?.max || 1);
      ui.timer.textContent = recovery(game) || game.message || (game.state === 'unbound' ? '在下方绑定账号后自动同步' : '等待游戏数据');
      ui.metrics.replaceChildren();
      for (const metric of game.metrics || Object.keys(metricIcons[ui.game]).map(label => ({ label }))) {
        const entry = el('div', 'games-metric'), term = el('dt'), text = el('span', '', metric.label);
        const icon = metricIcons[ui.game][metric.label]; if (icon) term.append(asset(icon));
        term.append(text); entry.append(term, el('dd', '', metric.text ?? `${number(metric.current)} / ${number(metric.max)}`)); ui.metrics.append(entry);
      }
      ui.updated.textContent = game.updatedAt ? `同步于 ${date(game.updatedAt)}${game.stale && game.message ? ' · ' + game.message : ''}` : game.message || '';
    }
  }
  async function api(route, method, body) {
    const response = await fetch(new URL('api/private/games/' + route, document.baseURI), { method, signal: context.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试。'); return result;
  }
  async function action(fn) {
    if (busy || context.view === 'lab') return;
    busy = true; card.querySelectorAll('button').forEach(button => button.disabled = true); status.textContent = '正在连接游戏社区…';
    try { await fn(); if (alive) { status.textContent = '已读取状态；手动同步间隔至少 1 分钟。'; draw(); } }
    catch (error) { if (alive) status.textContent = error.message; }
    finally { busy = false; if (alive) card.querySelectorAll('button').forEach(button => button.disabled = false); }
  }
  refresh.addEventListener('click', () => action(async () => { value = await api('refresh', 'POST'); }), { signal: context.signal });
  const details = el('details', 'games-binding'); details.append(el('summary', '', '账号绑定与管理'));
  details.append(el('p', '', '凭据仅加密保存在本站服务器，不写入页面内容。每个平台绑定一个账号，读取社区默认角色；没有默认角色时使用首个角色。'));
  const qr = qrBinding({ api, signal: context.signal, onBound: async () => { value = await api('refresh', 'POST'); if (alive) draw(); } });
  details.append(qr.root);
  details.addEventListener('toggle', () => { if (!details.open) void qr.close(); }, { signal: context.signal });
  const manual = el('details', 'games-manual'); manual.append(el('summary', '', '手动绑定与解除绑定')); details.append(manual);
  for (const [provider, label, hint] of [['miyoushe', '米游社', '粘贴已登录米游社的 Cookie；请先开启原神实时便笺。'], ['skland', '森空岛', '粘贴森空岛 Cred；同一账号可读取明日方舟与终末地。']]) {
    const form = el('form', 'games-bind-form'), caption = el('label', '', label), input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 12000; input.placeholder = provider === 'miyoushe' ? '米游社 Cookie' : '森空岛 Cred'; input.setAttribute('aria-label', input.placeholder);
    caption.append(input);
    const bind = el('button', 'button outline', '绑定 / 更新'), remove = el('button', 'text-button', '解除绑定'); bind.type = 'submit'; remove.type = 'button';
    form.append(caption, bind, remove, el('small', '', hint));
    form.addEventListener('submit', event => { event.preventDefault(); const credential = input.value; if (!credential.trim()) { status.textContent = '请先输入账号凭据。'; return; } action(async () => { await qr.close(); await api('account', 'PUT', { provider, credential }); input.value = ''; value = await api('refresh', 'POST'); }); }, { signal: context.signal });
    remove.addEventListener('click', () => action(async () => { await qr.close(); await api('account', 'PUT', { provider, disconnect: true }); input.value = ''; value = await api('refresh', 'POST'); }), { signal: context.signal });
    manual.append(form);
  }
  if (context.view !== 'lab') card.append(details);
  else { refresh.disabled = true; status.textContent = '实验台不绑定账号，请在私人页操作。'; }
  const timer = setInterval(() => { if (alive && document.visibilityState !== 'hidden') draw(); }, 30000);
  return { update(data, resource) { title.textContent = data.title; if (!busy && resource?.value) value = resource.value; if (resource?.error) { status.textContent = '读取失败，请检查登录状态或稍后刷新。'; if (value) value = { ...value, games: value.games.map(game => ({ ...game, stale: !!game.updatedAt, state: 'unavailable' })) }; } draw(); }, dispose() { alive = false; qr.dispose(); clearInterval(timer); } };
}
