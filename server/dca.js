import { externalJson, cachedProvider } from './external.js';
import { symbol, startDate, every } from '../modules/dca/plan.js';

const YEARS = 10, POINTS = 200;
const day = time => new Date(time).toISOString().slice(0, 10);
const round = value => Number(value.toPrecision(7));

// k-th scheduled buy date: same weekday every week, or the same day each month (clamped to month end).
function scheduled(start, step, k) {
  const date = new Date(`${start}T00:00:00Z`);
  if (step === 'week') return day(date.getTime() + k * 7 * 86400000);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + k, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return day(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), last)));
}

// series: ascending [date, price]. One unit of money per period, bought on the first trading day on or after each scheduled date.
export function simulate(series, start, step) {
  let units = 0, periods = 0, due = start, k = 0;
  const rows = [];
  for (const [date, price] of series) {
    if (date < start) continue;
    while (due <= date) { units += 1 / price; periods++; due = scheduled(start, step, ++k); }
    // The first period always sits exactly at 0; the signal only means something once there is an average.
    rows.push([date, price, periods / units, periods > 1 && price * units <= periods]);
  }
  if (!rows.length) return { available: false, reason: '起点之后还没有行情数据。' };
  const [asOf, price, cost, signal] = rows.at(-1);
  let first = rows.length - 1;
  while (first > 0 && rows[first - 1][3] === signal) first--;
  const since = rows[first][0], lastSignal = signal ? asOf : rows.findLast(row => row[3])?.[0] ?? null;
  const stride = Math.max(1, Math.ceil(rows.length / POINTS));
  const points = rows.filter((_, i) => (rows.length - 1 - i) % stride === 0).map(([date, p, c]) => [date, round(p), round(c)]);
  return { available: true, start: rows[0][0], asOf, periods, price: round(price), cost: round(cost), return: round(price / cost - 1), signal, since, lastSignal, points };
}

async function quoteSeries(secid, start, fetcher) {
  const params = new URLSearchParams({ secid, fields1: 'f1,f2,f3,f4,f5', fields2: 'f51,f53', klt: '101', fqt: '1', beg: start.replaceAll('-', ''), end: '20500101' });
  const data = await externalJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, fetcher);
  if (!Array.isArray(data.data?.klines)) throw new Error('没有找到这个标的的行情。');
  return data.data.klines.map(line => { const [date, close] = String(line).split(','); return [date, Number(close)]; });
}

async function fundSeries(code, start, fetcher) {
  const params = new URLSearchParams({ FCODE: code, pageIndex: '1', pagesize: '2600', plat: 'Android', appType: 'ttjj', product: 'EFund', Version: '1', deviceid: 'mosaic' });
  const data = await externalJson(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?${params}`, fetcher);
  if (!Array.isArray(data.Datas) || !data.Datas.length) throw new Error('没有找到这只基金的净值。');
  // Newest first. Walk back from today's NAV so dividends and splits do not look like price drops:
  // on ordinary days the NAV ratio is exact, on event days only the reported growth rate is right.
  const series = []; let adjusted = Number(data.Datas[0].DWJZ);
  for (let i = 0; i < data.Datas.length && data.Datas[i].FSRQ >= start; i++) {
    const row = data.Datas[i], previous = data.Datas[i + 1];
    series.push([String(row.FSRQ), adjusted]);
    if (!previous) break;
    const ratio = Number(row.DWJZ) / Number(previous.DWJZ) - 1, reported = Number(row.JZZZL) / 100;
    const growth = row.JZZZL !== '' && Number.isFinite(reported) && Math.abs(ratio - reported) > 0.00011 ? reported : ratio;
    adjusted /= 1 + growth;
  }
  return series.reverse();
}

const CLASSES = { Index: '指数', UniversalIndex: '指数', Fund: '场内基金', OTCFUND: '场外基金', UsStock: '美股', AStock: 'A股', HK: '港股' };
const HORIZONS = [1, 2, 3, 5], WINDOWS = [['1周', 0, 7], ['1月', 1, 0], ['3月', 3, 0], ['6月', 6, 0], ['1年', 12, 0], ['2年', 24, 0]];
const SLACK = 4 * 86400000; // history may start a weekend late and still cover a window

// Calendar offset back from a date, clamped to the month end like the schedule.
function before(date, months, days = 0) {
  const from = new Date(`${date}T00:00:00Z`), target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return day(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(from.getUTCDate(), last)) - days * 86400000);
}
const covers = (series, date) => Date.parse(series[0][0]) <= Date.parse(date) + SLACK;

// The same plan started 1, 2, 3 and 5 years before the latest quote; horizons the history does not reach are left out.
export function horizons(series, step) {
  const asOf = series.at(-1)[0];
  return HORIZONS.map(years => [years, before(asOf, years * 12)]).filter(([, start]) => covers(series, start)).map(([years, start]) => {
    const { periods, cost, return: gain, signal } = simulate(series, start, step);
    return { label: `${years}年`, start, periods, cost, return: gain, signal };
  });
}
// Plain mean of the closes in each trailing window, and how far the latest price sits from it.
export function averages(series) {
  const [asOf, price] = series.at(-1);
  return WINDOWS.map(([label, months, days]) => [label, before(asOf, months, days)]).filter(([, cutoff]) => covers(series, cutoff)).map(([label, cutoff]) => {
    const closes = series.filter(([date]) => date > cutoff).map(([, close]) => close), mean = closes.reduce((sum, close) => sum + close, 0) / closes.length;
    return { label, mean: round(mean), diff: round(price / mean - 1) };
  });
}

export function dcaProvider(fetcher) {
  // One bounded page of history per symbol; every plan, horizon and average is computed from it.
  const history = cachedProvider(30 * 60000, async id => {
    const [kind, code] = id.split(':'), now = new Date();
    const floor = day(Date.UTC(now.getUTCFullYear() - YEARS, now.getUTCMonth(), now.getUTCDate()));
    const series = (await (kind === 'fund' ? fundSeries : quoteSeries)(code, floor, fetcher)).filter(([date, price]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(price) && price > 0);
    return { floor, series, fetchedAt: now.toISOString() };
  });
  // Fund type is a label only: a failed lookup never blocks the signal.
  const profile = cachedProvider(86400000, async code => {
    const params = new URLSearchParams({ FCODE: code, plat: 'Android', appType: 'ttjj', product: 'EFund', Version: '1', deviceid: 'mosaic' });
    const info = (await externalJson(`https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation?${params}`, fetcher)).Datas || {};
    const label = value => typeof value === 'string' && value !== '--' ? value.slice(0, 30) : '';
    return { category: label(info.FTYPE), tracks: label(info.INDEXNAME) };
  });
  async function read(id, start, step) {
    const [{ floor, series, fetchedAt }, about] = await Promise.all([history(id), id.startsWith('fund:') ? profile(id.slice(5)).catch(() => ({})) : {}]);
    const from = start < floor ? floor : start, result = { ...simulate(series, from, step), clamped: from !== start, fetchedAt, category: about.category || '', tracks: about.tracks || '' };
    return series.length ? { ...result, horizons: horizons(series, step), averages: averages(series) } : result;
  }
  const search = cachedProvider(3600000, async input => {
    const data = await externalJson(`https://searchapi.eastmoney.com/api/suggest/get?${new URLSearchParams({ input, type: '14', token: 'D43BF722C8E33BDC906FB84D85E326E8', count: '10' })}`, fetcher);
    const items = [];
    for (const item of data.QuotationCodeTable?.Data || []) {
      const kind = CLASSES[item.Classify]; if (!kind) continue;
      const id = item.Classify === 'OTCFUND' ? `fund:${item.Code}` : `quote:${item.QuoteID}`;
      try { symbol(id); } catch { continue; }
      items.push({ symbol: id, name: String(item.Name).slice(0, 60), code: String(item.Code).slice(0, 12), kind });
    }
    return { items: items.slice(0, 8) };
  });
  return { read: (id, start, step) => read(symbol(id), startDate(start), every(step)), search };
}
