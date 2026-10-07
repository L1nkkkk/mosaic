import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProxies } from '../server/proxies.js';
import { render, validate } from '../modules/proxy-nodes/index.js';

test('proxy snapshots distinguish missing, malformed, stale and future data', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'proxy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'proxies.json');
  assert.equal((await readProxies(filename)).available, false);
  await writeFile(filename, '{invalid');
  assert.equal((await readProxies(filename)).available, false);
  for (const offset of [-21 * 60000, 60000]) {
    await writeFile(filename, JSON.stringify({ schemaVersion: 1, collectedAt: new Date(Date.now() + offset).toISOString(), nodes: [] }));
    assert.equal((await readProxies(filename)).stale, true);
  }
  const at = new Date().toISOString();
  await writeFile(filename, JSON.stringify({ schemaVersion: 1, collectedAt: at, nodes: [null, { name: 'test', ip: '<script>', delayMs: 90, delayAt: '2000-01-01', samples: -1, changes: '0' }] }));
  const result = await readProxies(filename);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].ip, null);
  assert.equal(result.nodes[0].delayMs, null);
  assert.equal(result.nodes[0].samples, null);
  assert.equal(result.nodes[0].changes, null);
});

test('node UI escapes resources, degrades stale results and never infers static IP', () => {
  const at = new Date().toISOString();
  const snapshot = { available: true, stale: false, collectedAt: at, groups: [], nodes: [{ name: '<img src=x>', ip: '8.8.8.8', reachable: true, checkedAt: at, delayMs: 90, delayAt: at, samples: 100, changes: 0, city: '<script>', stableSince: at, lastSeen: at }] };
  const html = render(validate({ title: '代理节点' }), { value: snapshot });
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('90 ms'));
  assert.ok(html.includes('暂未变化'));
  assert.ok(html.includes('静态 IP 未确认'));
  const stale = render({}, { value: { ...snapshot, stale: true } });
  assert.ok(stale.includes('上次成功结果'));
  assert.ok(!stale.includes('90 ms'));
  assert.ok(stale.includes('状态过期'));
  snapshot.nodes[0].changes = 1;
  assert.ok(render({}, { value: snapshot }).includes('曾变化'));
  assert.ok(render({}, { error: 'no' }).includes('读取失败'));
  assert.ok(render({}).includes('等待采集'));
});
