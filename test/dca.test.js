import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, dcaProvider } from '../server/dca.js';
import { validate } from '../modules/dca/definition.js';

test('simulated plan buys on schedule and signals once price is at or under the average cost', () => {
  // Weekly from a Monday; the second buy day is a holiday, so it moves to the next trading day.
  const series = [['2026-01-02', 9], ['2026-01-05', 10], ['2026-01-06', 12], ['2026-01-13', 20], ['2026-01-14', 16], ['2026-01-19', 10]];
  const up = simulate(series.slice(0, 5), '2026-01-05', 'week');
  assert.deepEqual([up.start, up.asOf, up.periods, up.signal, up.lastSignal], ['2026-01-05', '2026-01-14', 2, false, null]);
  assert.ok(Math.abs(up.cost - 2 / (1 / 10 + 1 / 20)) < 1e-4 && up.return > 0);
  const down = simulate(series, '2026-01-05', 'week');
  assert.deepEqual([down.periods, down.signal, down.since, down.lastSignal], [3, true, '2026-01-19', '2026-01-19']);
  assert.ok(down.return < 0 && down.points.length === 5);
  // A single period is always at exactly 0 and must not count as a signal.
  assert.equal(simulate(series.slice(0, 3), '2026-01-05', 'week').signal, false);
  assert.equal(simulate(series, '2027-01-01', 'week').available, false);
  // Monthly plans clamp to the month end: 01-31 → 02-28 → 03-31.
  const monthly = simulate([['2026-01-31', 1], ['2026-02-27', 1], ['2026-02-28', 1], ['2026-03-30', 1], ['2026-03-31', 1]], '2026-01-31', 'month');
  assert.equal(monthly.periods, 3);
});

test('fund history is adjusted for dividends and long series are thinned', async () => {
  // Newest first: on 01-06 the NAV drops from 2 to 1.1 with a reported +10% day, i.e. a payout rather than a loss.
  const Datas = [{ FSRQ: '2026-01-07', DWJZ: '1.1', JZZZL: '0.00' }, { FSRQ: '2026-01-06', DWJZ: '1.1', JZZZL: '10.00' }, { FSRQ: '2026-01-05', DWJZ: '2.0', JZZZL: '' }];
  let urls = [];
  const fund = dcaProvider(async url => { urls.push(String(url)); return Response.json({ Datas, secret: 'discard' }); });
  const value = await fund.read('fund:110020', '2026-01-05', 'week');
  assert.match(urls[0], /^https:\/\/fundmobapi\.eastmoney\.com\/.*FundMNHisNetList.*FCODE=110020/);
  assert.deepEqual(value.points.map(point => point[1]), [1, 1.1, 1.1]);
  assert.ok(value.return > 0.09 && !JSON.stringify(value).includes('discard'));
  // Three days of history reach no fixed horizon and no averaging window.
  assert.deepEqual([value.horizons, value.averages, value.category], [[], [], '']);
  await fund.read('fund:110020', '2026-01-06', 'month');
  assert.equal(urls.length, 2, 'plans on one fund share its history and its profile');
  const typed = dcaProvider(async url => Response.json(String(url).includes('BasicInformation') ? { Datas: { FTYPE: '指数型-股票', INDEXNAME: '--', JJGS: 'discard' } } : { Datas }));
  assert.deepEqual((({ category, tracks }) => [category, tracks])(await typed.read('fund:110020', '2026-01-05', 'week')), ['指数型-股票', '']);
  const untyped = dcaProvider(async url => String(url).includes('BasicInformation') ? new Response('', { status: 500 }) : Response.json({ Datas }));
  assert.equal((await untyped.read('fund:110020', '2026-01-05', 'week')).available, true, 'a failed type lookup does not block the signal');

  const klines = Array.from({ length: 900 }, (_, i) => `${new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)},${100 + i}`);
  const quote = dcaProvider(async url => { urls.push(String(url)); return Response.json({ data: { name: 'x', klines } }); });
  const long = await quote.read('quote:1.000300', '2024-01-01', 'month');
  assert.match(urls.at(-1), /push2his\.eastmoney\.com.*secid=1\.000300.*beg=\d{8}/);
  assert.ok(long.points.length <= 200 && long.points.at(-1)[0] === long.asOf);
  // 900 rising days ending 2026-06-18: one and two years fit, three do not; a rising price sits above every mean.
  assert.deepEqual(long.horizons.map(item => [item.label, item.start, item.signal]), [['1年', '2025-06-18', false], ['2年', '2024-06-18', false]]);
  assert.ok(long.horizons[1].periods > long.horizons[0].periods && long.horizons[1].return > long.horizons[0].return);
  assert.deepEqual(long.averages.map(item => item.label), ['1周', '1月', '3月', '6月', '1年', '2年']);
  assert.equal(long.averages[0].mean, 996); // closes 993…999
  assert.ok(long.averages.every((item, i, all) => item.diff > 0 && (!i || item.mean < all[i - 1].mean)));
  assert.throws(() => quote.read('quote:https://evil.test', '2024-01-01', 'month'), /搜索结果/);
  await assert.rejects(dcaProvider(async () => Response.json({ data: null })).read('quote:1.999999', '2024-01-01', 'week'));
});

test('search keeps only supported classes and maps funds and quotes to symbols', async () => {
  const provider = dcaProvider(async () => Response.json({ QuotationCodeTable: { Data: [
    { Code: '110020', Name: 'Jeonjin Bio', Classify: 'KRX', QuoteID: '177.110020' },
    { Code: '110020', Name: '易方达沪深300ETF联接A', Classify: 'OTCFUND', QuoteID: '150.110020' },
    { Code: '000300', Name: '沪深300', Classify: 'Index', QuoteID: '1.000300' },
    { Code: 'QQQ', Name: '纳斯达克100ETF', Classify: 'UsStock', QuoteID: '105.QQQ' },
    { Code: 'BAD', Name: '坏数据', Classify: 'UsStock', QuoteID: '../x' }] } }));
  assert.deepEqual((await provider.search('110020')).items.map(item => item.symbol), ['fund:110020', 'quote:1.000300', 'quote:105.QQQ']);
});

test('plan data is validated without depending on the current date', () => {
  const plan = { id: 'a1', symbol: 'quote:1.000300', name: '沪深300', kind: '指数', start: '2001-02-03', every: 'week' };
  assert.deepEqual(validate({ title: ' 定投 ', plans: [{ ...plan, extra: 1 }] }), { title: '定投', show: ['tags', 'horizons', 'chart', 'note', 'averages'], plans: [plan] });
  assert.deepEqual(validate({ title: '', show: ['averages', 'tags', 'tags'], plans: [] }).show, ['tags', 'averages']);
  assert.deepEqual(validate({ title: '', show: [], plans: [] }).show, []);
  assert.throws(() => validate({ title: '', show: ['everything'], plans: [] }));
  assert.equal(validate({ title: '', plans: [{ ...plan, kind: undefined }] }).plans[0].kind, '');
  for (const bad of [{ symbol: 'quote:x' }, { start: '2026-02-30' }, { start: '20260101' }, { every: 'day' }, { name: '' }, { id: 'A b' }])
    assert.throws(() => validate({ title: '', plans: [{ ...plan, ...bad }] }));
  assert.throws(() => validate({ title: '', plans: [plan, plan] }));
  assert.throws(() => validate({ title: '', plans: Array.from({ length: 9 }, (_, i) => ({ ...plan, id: `p${i}` })) }));
});
