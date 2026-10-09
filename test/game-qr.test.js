import test from 'node:test';
import assert from 'node:assert/strict';
import { GameQr } from '../server/game-qr.js';
import { qrFetchFixture } from './fixtures/game-qr.js';
function fixture() {
  const source = qrFetchFixture(), saved = []; let now = 1800000000000;
  const qr = new GameQr({ configure: async payload => { saved.push(payload); return { ok: true }; } }, source.fetch, () => now);
  return { qr, source, saved, advance: ms => now += ms };
}
for (const provider of ['miyoushe', 'skland']) test(`${provider}: pending, confirmation, credential exchange exactly once and no secret in status`, async () => {
  const f = fixture(), flow = await f.qr.start(provider, 'owner');
  assert.ok(flow.qr); assert.equal((await f.qr.status(flow.id, 'owner')).state, 'waiting');
  const count = f.source.calls.length; await f.qr.status(flow.id, 'owner'); assert.equal(f.source.calls.length, count);
  f.source.scanned = true; f.advance(3000); assert.equal((await f.qr.status(flow.id, 'owner')).state, 'scanned');
  f.source.confirmed = true; f.advance(3000);
  const results = await Promise.all([f.qr.status(flow.id, 'owner'), f.qr.status(flow.id, 'owner')]);
  assert.equal(results[0].state, 'bound'); assert.equal(f.saved.length, 1);
  assert.ok(!JSON.stringify(results).includes('secret-')); assert.ok(!f.saved[0].credential.includes('DO-NOT-STORE'));
  assert.equal(f.saved[0].provider, provider);
  assert.ok(f.source.calls.every(call => call.options.redirect === 'error'));
});
test('ownership, cancellation, replacement, expiry and cooldown prevent stale authorization', async () => {
  const f = fixture(), first = await f.qr.start('miyoushe', 'one');
  await assert.rejects(f.qr.status(first.id, 'two'));
  await f.qr.cancel(first.id, 'two'); assert.equal((await f.qr.status(first.id, 'one')).state, 'waiting');
  await assert.rejects(f.qr.start('miyoushe', 'one'), /10 秒/);
  f.advance(11000); const second = await f.qr.start('miyoushe', 'one');
  await assert.rejects(f.qr.status(first.id, 'one'));
  f.advance(100001); f.source.confirmed = true;
  assert.equal((await f.qr.status(second.id, 'one')).state, 'expired'); assert.equal(f.saved.length, 0);
  const third = await f.qr.start('skland', 'one'); await f.qr.cancel(third.id, 'one'); await assert.rejects(f.qr.status(third.id, 'one'));
});
test('manual changes invalidate pending QR; upstream errors never reach clients', async () => {
  const f = fixture(), flow = await f.qr.start('skland', 'owner');
  await f.qr.configure({ provider: 'skland', disconnect: true }); await assert.rejects(f.qr.status(flow.id, 'owner'));
  const mi = await f.qr.start('miyoushe', 'owner'); f.source.fail = true;
  const result = await f.qr.status(mi.id, 'owner'); assert.equal(result.state, 'error'); assert.ok(!JSON.stringify(result).includes('SECRET-UPSTREAM'));
});
test('queued disconnect after in-flight confirmation leaves account disconnected', async () => {
  const f = fixture(), flow = await f.qr.start('miyoushe', 'owner'); f.source.confirmed = true;
  await Promise.all([f.qr.status(flow.id, 'owner'), f.qr.configure({ provider: 'miyoushe', disconnect: true })]);
  assert.equal(f.saved.at(-1).disconnect, true); await assert.rejects(f.qr.status(flow.id, 'owner'));
});

test('Skland reports upstream expiry before local deadline', async () => {
  const f = fixture(), flow = await f.qr.start('skland', 'owner'); f.source.expired = true;
  assert.equal((await f.qr.status(flow.id, 'owner')).state, 'expired'); assert.equal(f.saved.length, 0);
});
