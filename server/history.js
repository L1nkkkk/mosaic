import { DatabaseSync } from 'node:sqlite';
import { stat } from 'node:fs/promises';

const ranges = { '1h': [3600, 30], '6h': [21600, 60], '24h': [86400, 300], '7d': [604800, 1800] };
const metrics = ['cpu', 'memory', 'rx', 'tx'];
const invalid = () => Object.assign(new Error('历史查询参数不正确。'), { status: 400 });
const clean = value => Number.isFinite(value) && value >= 0 ? value : null;

// Cache one bounded result per range. Many visitors never trigger more collection.
export function historyReader(filename) {
  const cache = new Map();
  return async (params, now = Math.floor(Date.now() / 1000)) => {
    const range = params.get('range') || '1h', configuration = ranges[range];
    if (!Object.hasOwn(ranges, range) || [...params.keys()].some(key => !['range', 'end', 'since'].includes(key))) throw invalid();
    const parse = key => { const raw = params.get(key); if (raw === null) return null; if (!/^\d{1,13}$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw invalid(); return Number(raw); };
    const end = parse('end') ?? now, since = parse('since');
    const [duration, step] = configuration;
    if (end > now + 10 || end < now - 604800 || since !== null && since > end) throw invalid();
    const start = end - duration;
    const empty = { available: false, range, start, end, step, points: [], lastCollectedAt: null, retainedFrom: null };
    if (!filename) return empty;
    let database;
    try {
      const file = await stat(filename);
      const key = `${range}:${params.has('end') ? end : Math.floor(now / 30)}`;
      const cached = cache.get(range);
      let result = cached?.key === key && cached.mtime === file.mtimeMs ? cached.value : null;
      if (!result) {
        database = new DatabaseSync(filename, { readOnly: true });
        database.exec('PRAGMA busy_timeout=250');
        const table = range === '7d' ? 'buckets' : 'samples';
        const bounds = database.prepare(`SELECT MIN(t) AS first, MAX(t) AS last FROM ${table}`).get();
        let points;
        if (table === 'buckets') {
          points = database.prepare('SELECT * FROM buckets WHERE t >= ? AND last <= ? ORDER BY t').all(Math.floor(start / step) * step, end).map(row => {
            const point = { t: row.t, gap: Boolean(row.gap), count: row.n };
            for (const metric of metrics) point[metric] = row[`${metric}_count`] ? { avg: clean(row[`${metric}_sum`] / row[`${metric}_count`]), min: clean(row[`${metric}_min`]), max: clean(row[`${metric}_max`]) } : null;
            return point;
          });
        } else {
          const rows = database.prepare('SELECT * FROM samples WHERE t >= ? AND t <= ? ORDER BY t').all(start, end);
          const grouped = new Map();
          for (const [index, row] of rows.entries()) {
            row.gap = index > 0 && row.t - rows[index - 1].t > 90;
            const t = step === 30 ? row.t : Math.floor(row.t / step) * step;
            if (!grouped.has(t)) grouped.set(t, []);
            grouped.get(t).push(row);
          }
          points = [...grouped].map(([t, rows]) => {
            const point = { t, count: rows.length, gap: rows.some((row, i) => row.gap || metrics.some(metric => row[metric] === null) || i > 0 && row.t - rows[i - 1].t > 90) };
            for (const metric of metrics) {
              const values = rows.map(row => clean(row[metric])).filter(value => value !== null);
              point[metric] = values.length ? { avg: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) } : null;
            }
            return point;
          });
        }
        const latest = database.prepare('SELECT MAX(t) AS t FROM samples').get().t;
        result = { ...empty, available: true, points, lastCollectedAt: latest, retainedFrom: bounds.first };
        cache.set(range, { key, mtime: file.mtimeMs, value: result });
      }
      // Resend the last bucket, because its average/peak can still change.
      return { ...result, start, end, points: result.points.filter(point => since === null || point.t >= Math.floor(since / step) * step) };
    } catch { return empty; }
    finally { database?.close(); }
  };
}
