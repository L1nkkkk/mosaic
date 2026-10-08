import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { historyReader } from '../server/history.js';

test('history windows bound queries, preserve missing data and peaks, and revise the latest bucket', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'history.sqlite'), db = new DatabaseSync(filename);
  db.exec('CREATE TABLE samples(t INTEGER PRIMARY KEY,cpu REAL,memory REAL,rx REAL,tx REAL)');
  const start = 1800000000, insert = db.prepare('INSERT INTO samples VALUES(?,?,?,?,?)');
  for (let i = 0; i < 2881; i++) insert.run(start + i * 30, i % 2 ? 90 : 10, 50, 2000, 1000);
  const now = start + 86400, read = historyReader(filename);
  await chmod(filename, 0o444);
  const first = await read(new URLSearchParams('range=1h'), now);
  assert.equal(first.points.length, 121); assert.equal(first.step, 30);
  const day = await read(new URLSearchParams('range=24h'), now);
  assert.ok(day.points.length <= 289); assert.equal(day.points[0].cpu.max, 90); assert.equal(day.points[0].cpu.avg, 50);
  const incremental = await read(new URLSearchParams(`range=24h&since=${day.points.at(-1).t}`), now);
  assert.equal(incremental.points.length, 1);
  await chmod(filename, 0o644);
  db.prepare('UPDATE samples SET cpu=NULL WHERE t=?').run(now);
  const missing = await read(new URLSearchParams('range=1h'), now + 30);
  assert.equal(missing.points.at(-1).cpu, null);
  assert.equal(missing.points.at(-1).gap, true);
  for (const params of ['range=all', 'range=constructor', 'range=1h&end=abc', `end=${now + 100}`, 'limit=999999', `end=${now - 700000}`]) await assert.rejects(read(new URLSearchParams(params), now), error => error.status === 400);
  db.close();
});

test('missing or corrupt history degrades without disrupting current status', async () => {
  const result = await historyReader('/nonexistent/mosaic/history.sqlite')(new URLSearchParams());
  assert.equal(result.available, false); assert.deepEqual(result.points, []);
});
