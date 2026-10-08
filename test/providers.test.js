import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Visitors } from '../server/visitors.js';
import { externalJson } from '../server/external.js';

test('visitor aggregation counts daily uniques, caps lookups, prunes daily identifiers and keeps totals', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-visitors-'));
  let calls = 0;
  const visitors = new Visitors(directory, 'test-only-secret', async () => { calls++; return Response.json({ success: true, country_code: 'US', ip: 'discard' }); });
  t.after(async () => { visitors.close(); await rm(directory, { recursive: true, force: true }); });
  const now = Date.now();
  await visitors.record('8.8.8.8', 'browser', now);
  await visitors.record('8.8.8.8', 'browser', now + 100);
  await visitors.record('8.8.8.8', 'browser', now + 31000);
  assert.equal(calls, 1);
  const stats = visitors.read(now + 31000);
  assert.deepEqual({ ...stats.today }, { views: 2, visitors: 1 });
  assert.equal(stats.regions[0].code, 'US'); assert.equal(stats.regions[0].visitors, 1);
  visitors.db.prepare('UPDATE days SET lookups=900').run();
  await visitors.record('1.1.1.1', 'browser', now + 32000);
  assert.equal(calls, 1); assert.equal(visitors.read(now + 32000).regions.find(row => row.code === 'ZZ').visitors, 1);
  assert.ok(!(await readFile(path.join(directory, 'visitors.sqlite'))).includes(Buffer.from('8.8.8.8')));
  assert.equal(visitors.read(now + 91 * 86400000).totalViews, 3);
  assert.equal(visitors.db.prepare('SELECT COUNT(*) AS n FROM seen').get().n, 0);
  assert.equal(visitors.db.prepare('SELECT COUNT(*) AS n FROM days').get().n, 0);
});

test('providers reject errors and oversized replies', async () => {
  await assert.rejects(externalJson('https://example.test', async () => new Response('bad', { status: 503 })));
  await assert.rejects(externalJson('https://example.test', async () => new Response('x'.repeat(524289))));
});
