import { field, fields } from '../../web/ui.js';
import { EVERY, PARTS, planKey } from './plan.js';
export { validate } from './definition.js';

const percent = value => `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
const amount = value => value.toFixed(value >= 1000 ? 2 : value >= 10 ? 3 : 4);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const element = (tag, className, textContent = '') => Object.assign(document.createElement(tag), { className, textContent });

export async function load({ request, data }) {
  const results = {};
  await Promise.all(data.plans.map(async plan => {
    const key = planKey(plan);
    try { results[plan.id] = { key, value: await request(`private/dca?${new URLSearchParams({ symbol: plan.symbol, start: plan.start, every: plan.every })}`) }; }
    catch (error) { if (error.status === 401) throw error; results[plan.id] = { key, error: true }; }
  }));
  return { results };
}

export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const commit = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => commit({ title }), { maxLength: 100 }));
  const parts = element('fieldset', 'dca-parts'); parts.append(element('legend', '', '每个标的显示'));
  for (const [part, label] of Object.entries(PARTS)) {
    const option = element('label', 'dca-part'), box = element('input', ''); box.type = 'checkbox'; box.checked = data.show.includes(part);
    box.onchange = () => commit({ show: Object.keys(PARTS).filter(key => key === part ? box.checked : data.show.includes(key)) });
    option.append(box, label); parts.append(option);
  }
  wrapper.append(parts);
  data.plans.forEach((plan, index) => {
    const patch = next => commit({ plans: data.plans.map((entry, i) => i === index ? { ...entry, ...next } : entry) });
    const row = fields(); row.classList.add('link-editor', 'dca-editor');
    const start = element('label', 'field'), date = element('input', '');
    date.type = 'date'; date.value = plan.start; date.min = '1990-01-01'; date.oninput = () => { if (date.value) patch({ start: date.value }); };
    start.append(element('span', '', '从哪天开始定投'), date);
    const step = element('label', 'field'), select = element('select', '');
    for (const [value, label] of Object.entries(EVERY)) select.append(new Option(label, value, false, value === plan.every));
    select.onchange = () => patch({ every: select.value });
    step.append(element('span', '', '频率'), select);
    const remove = element('button', 'text-button danger', '移除这个标的'); remove.type = 'button';
    remove.onclick = () => commit({ plans: data.plans.filter((_, i) => i !== index) }, true);
    row.append(element('strong', 'dca-editor-name', plan.name), start, step, remove); wrapper.append(row);
  });
  if (data.plans.length < 8) {
    const form = element('div', 'dca-search');
    const input = element('input', ''); input.placeholder = '名称或代码：沪深300、110020、QQQ'; input.setAttribute('aria-label', '搜索标的'); input.maxLength = 40;
    const button = element('button', 'button outline', '搜索标的'); button.type = 'button';
    const status = element('small', '', '指数、场内 ETF、场外基金和美股都可以。'); status.setAttribute('role', 'status');
    const results = element('div', 'dca-search-results');
    button.onclick = async () => {
      button.disabled = true; status.textContent = '正在搜索…'; results.replaceChildren();
      try {
        const response = await fetch(new URL(`api/admin/securities?${new URLSearchParams({ name: input.value.trim() })}`, document.baseURI));
        const value = await response.json(); if (!response.ok) throw new Error(value.error);
        for (const item of value.items) {
          const choice = element('button', 'button subtle', `${item.name} · ${item.kind} ${item.code}`); choice.type = 'button';
          choice.onclick = () => {
            const now = new Date(), start = new Date(Date.UTC(now.getFullYear() - 1, now.getMonth(), now.getDate())).toISOString().slice(0, 10);
            commit({ plans: [...data.plans, { id: Math.random().toString(36).slice(2, 10), symbol: item.symbol, name: item.name, kind: item.kind, start, every: 'week' }] }, true);
          };
          results.append(choice);
        }
        status.textContent = value.items.length ? '选中后默认从一年前开始每周定投，可以再调整。' : '没有找到，换个名称或直接输入代码。';
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); button.click(); } };
    form.append(input, button, status, results); wrapper.append(form);
  }
  return wrapper;
}

const WIDTH = 300, HEIGHT = 64;
function chart(points, id, describe) {
  const values = points.flatMap(point => [point[1], point[2]]), low = Math.min(...values), span = Math.max(...values) - low || 1;
  const x = i => (points.length > 1 ? i / (points.length - 1) * WIDTH : WIDTH).toFixed(1), y = value => (HEIGHT - 4 - (value - low) / span * (HEIGHT - 8)).toFixed(1);
  const line = column => points.map((point, i) => `${i ? 'L' : 'M'}${x(i)},${y(point[column])}`).join('');
  const price = line(1), cost = line(2), back = points.map((point, i) => `L${x(i)},${y(point[2])}`).reverse().join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'dca-chart'); svg.setAttribute('aria-hidden', 'true');
  // Everything under the cost line is the entry zone: the same price path is drawn again there in the signal colour.
  svg.innerHTML = `<clipPath id="${id}"><path d="${cost}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z"/></clipPath>
    <path class="dca-zone" clip-path="url(#${id})" d="${price}${back}Z"/><path class="dca-price" d="${price}"/>
    <path class="dca-price is-under" clip-path="url(#${id})" d="${price}"/><path class="dca-cost" d="${cost}"/><line class="dca-cursor" y1="0" y2="${HEIGHT}"/>`;
  const cursor = svg.querySelector('.dca-cursor');
  svg.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect(), last = points.length - 1;
    const index = Math.max(0, Math.min(last, Math.round((event.clientX - box.left) / box.width * last))), [date, value, average] = points[index];
    const at = last ? index / last * WIDTH : WIDTH; cursor.setAttribute('x1', at); cursor.setAttribute('x2', at);
    describe(`${date} · 价格 ${amount(value)} · 成本线 ${amount(average)} · 定投收益 ${percent(value / average - 1)}`);
  });
  svg.addEventListener('pointerleave', () => describe(null));
  return svg;
}

function planRow(plan, entry, id, ui, parts) {
  const key = planKey(plan), row = element('li', 'dca-plan'), value = entry?.key === key ? entry.value : null;
  const head = element('div', 'dca-head'), title = element('div', 'dca-title'), read = element('div', 'dca-read'), tags = element('div', 'dca-tags');
  const figure = element('strong', '', '—'), pill = element('span', 'dca-pill'), span = element('small', '', `${EVERY[plan.every]} · 自 ${plan.start}`), note = element('p', 'dca-note');
  if (parts.has('tags')) for (const tag of [plan.kind, value?.category, value?.tracks && `跟踪 ${value.tracks}`]) if (tag) tags.append(element('span', '', tag));
  title.append(element('b', '', plan.name), tags, span); read.append(figure, pill); head.append(title, read); row.append(head);
  if (!value?.available) {
    row.dataset.state = 'idle';
    note.textContent = value ? value.reason : entry?.key === key && entry.error ? '行情暂时读取不到，稍后自动重试。' : '正在读取行情…';
    row.append(note); return row;
  }
  const stage = element('div', 'dca-stage'), chips = element('div', 'dca-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', '定投时长');
  let resting = '', token = 0;
  function show(view) {
    row.dataset.state = view.signal ? 'in' : 'out';
    figure.textContent = percent(view.return);
    pill.textContent = view.signal ? '适合入场' : view.periods < 2 ? '刚起步' : '等待回落';
    span.textContent = `${EVERY[plan.every]} · 自 ${view.start} · ${view.periods} 期`;
    const rest = view.signal ? `现价 ${amount(view.price)} 低于成本线 ${amount(view.cost)} · 已持续 ${daysBetween(view.since, view.asOf)} 天`
      : `现价 ${amount(view.price)} · 再跌 ${((1 - view.cost / view.price) * 100).toFixed(1)}% 触及成本线 ${amount(view.cost)}${view.lastSignal ? ` · 上次入场区 ${view.lastSignal}` : ''}`;
    note.textContent = resting = parts.has('note') ? `${rest} · 截至 ${view.asOf}${view.clamped ? ' · 最多回看 10 年' : ''}` : '';
    if (parts.has('chart')) stage.replaceChildren(chart(view.points, id, text => { note.textContent = text ?? resting; }));
  }
  // The plan's own start comes with the resource; the fixed horizons only carry their totals until one is opened.
  const options = [{ label: '自定', return: value.return, signal: value.signal, view: value }, ...(parts.has('horizons') && value.horizons || [])];
  async function select(option) {
    const mine = ++token; ui.picked.set(plan.id, option.label);
    for (const chip of chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.label === option.label));
    const cached = `${key}|${option.start}|${value.asOf}`; let view = option.view || ui.fetched.get(cached);
    if (!view) {
      note.textContent = '正在读取这段定投…';
      try { view = await ui.request(`private/dca?${new URLSearchParams({ symbol: plan.symbol, start: option.start, every: plan.every })}`); if (!view.available) throw new Error(); }
      catch { if (mine === token) note.textContent = '这段定投暂时读取不到。'; return; }
      if (ui.fetched.size > 40) ui.fetched.clear();
      ui.fetched.set(cached, view);
    }
    if (mine === token) show(view);
  }
  for (const option of options) {
    const chip = element('button', 'dca-chip'); chip.type = 'button'; chip.dataset.label = option.label; chip.dataset.signal = option.signal ? 'in' : 'out';
    chip.append(element('span', '', option.label), element('b', '', percent(option.return)));
    chip.onclick = () => select(option); chips.append(chip);
  }
  show(value); select(options.find(option => option.label === ui.picked.get(plan.id)) || options[0]);
  // Without the note the line stays as the chart's hover readout; with neither there is nothing to say.
  if (parts.has('horizons')) row.append(chips);
  if (parts.has('chart')) row.append(stage);
  if (parts.has('chart') || parts.has('note')) row.append(note);
  if (parts.has('averages') && value.averages?.length) {
    const means = element('dl', 'dca-means');
    for (const item of value.averages) {
      const cell = element('div', ''); cell.dataset.side = item.diff < 0 ? 'under' : 'over';
      cell.append(element('dt', '', `${item.label}均价`), element('dd', '', amount(item.mean)), element('dd', 'dca-diff', percent(item.diff)));
      means.append(cell);
    }
    row.append(means);
  }
  return row;
}

export function mount(context) {
  const card = element('article', 'dca-module'); card.dataset.ownBackground = '';
  card.innerHTML = '<header><h2></h2><span class="dca-summary" role="status"></span></header><ol class="dca-list"></ol><p class="dca-foot">价格线跌到虚线（定投平均成本）以下即入场区 · 均价下方是现价相对均价的偏离 · 行情来自东方财富，仅供参考</p>';
  context.root.append(card);
  // Which horizon each plan shows, and the horizons already opened, outlive the row rebuilds below.
  const ui = { picked: new Map(), fetched: new Map(), request: context.request };
  let signature = '';
  return { update(data, resource) {
    const results = resource?.value?.results || {}, parts = new Set(data.show), next = JSON.stringify([data, results, resource?.error]);
    if (next === signature) return; // A refresh with identical data keeps the hovered chart intact.
    signature = next;
    card.querySelector('h2').textContent = data.title;
    const live = data.plans.map(plan => results[plan.id]?.key === planKey(plan) ? results[plan.id].value : null).filter(value => value?.available);
    const signals = live.filter(value => value.signal).length;
    card.querySelector('.dca-summary').textContent = !data.plans.length ? '在编辑台添加要跟踪的标的' : resource?.error ? '行情暂时无法读取' : !live.length ? '' : signals ? `${signals} / ${live.length} 适合入场` : '暂无入场信号';
    card.dataset.signal = signals ? 'on' : 'off';
    card.querySelector('.dca-list').replaceChildren(...data.plans.map(plan => planRow(plan, results[plan.id], `dca-${context.id}-${plan.id}`, ui, parts)));
    card.querySelector('.dca-foot').hidden = !parts.has('chart') && !parts.has('averages');
  } };
}
