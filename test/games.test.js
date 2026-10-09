import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Games } from '../server/games.js';
import { normalizeGame, sklandHeaders } from '../server/game-providers.js';

import { gameFetchFixture } from './fixtures/games.js';
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-games-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = gameFetchFixture(); let now = 1800000000000;
  const games = new Games(directory, 'test-secret', source.fetch, () => now); await games.initialize();
  return { games, source, directory, advance: ms => now += ms };
}
test('three games use official hosts, signed role identities, normalized fields and shared caching', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=test-cookie' });
  await f.games.configure({ provider: 'skland', credential: 'test-cred-secret' });
  const results = await Promise.all([f.games.read(), f.games.read(), f.games.read(true)]);
  assert.deepEqual(results[0].games.map(game => game.energy.current), [150,120,200]);
  assert.equal(f.source.calls.filter(call => call.url.includes('dailyNote')).length, 1);
  assert.ok(!JSON.stringify(results).includes('SHOULD-NOT-PASS'));
  assert.ok(!JSON.stringify(results).includes('test-cred-secret'));
  const endfield = f.source.calls.find(call => call.url.includes('/endfield/card/detail'));
  assert.match(endfield.url, /roleId=ef-role&serverId=1&userId=skland-account-id/);
  assert.ok(endfield.headers.sign);
  assert.ok(f.source.calls.every(call => ['api-takumi.mihoyo.com','api-takumi-record.mihoyo.com','zonai.skland.com'].includes(new URL(call.url).hostname)));
});
test('encrypted vault survives restart; disconnect clears data and credentials', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=very-secret-cookie' });
  const filename = path.join(f.directory, 'game-accounts.enc');
  assert.ok(!(await readFile(filename, 'utf8')).includes('very-secret-cookie'));
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const restarted = new Games(f.directory, 'test-secret', f.source.fetch); await restarted.initialize();
  assert.equal((await restarted.read()).games[0].state, 'ready');
  await restarted.configure({ provider: 'miyoushe', disconnect: true });
  const unbound = (await restarted.read()).games[0];
  assert.equal(unbound.state, 'unbound'); assert.equal(unbound.energy, undefined);
});
test('failures keep last success, do not leak raw errors and retry after cooldown', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=test-cookie' });
  await f.games.read(); f.advance(301000); f.source.fail = 'genshin';
  const game = (await f.games.read()).games[0];
  assert.equal(game.state, 'verification'); assert.equal(game.stale, true); assert.equal(game.energy.current, 150);
  const calls = f.source.calls.length; await f.games.read(true); assert.equal(f.source.calls.length, calls);
  f.advance(61000); f.source.fail = 'all';
  assert.ok(!JSON.stringify(await f.games.read()).includes('DO-NOT-LEAK'));
  await assert.rejects(f.games.configure({ provider: 'miyoushe', credential: 'replacement-cookie' }));
  assert.equal(f.games.accounts.miyoushe, 'cookie=test-cookie');
  f.advance(61000); f.source.fail = null;
  assert.equal((await f.games.read()).games[0].stale, false);
});
test('malformed data is unknown, never fabricated as zero; overcap energy is preserved', () => {
  assert.throws(() => normalizeGame('endfield', { dungeon: {} }, {}, Date.now()));
  const result = normalizeGame('arknights', { status: { ap: { current: 180, max: 135 } } }, {}, Date.now());
  assert.equal(result.energy.current, 180); assert.equal(result.metrics[0].current, null);
  const headers = sklandHeaders('cred','token','https://zonai.skland.com/api/v1/game/player/info?uid=abc',1800000000000);
  assert.equal(headers.timestamp, '1799999999'); assert.match(headers.sign, /^[0-9a-f]{32}$/);
});

test('oversized upstream responses are rejected and wrong encryption keys fail explicitly', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=test-cookie' });
  const wrongKey = new Games(f.directory, 'different-key', f.source.fetch);
  await assert.rejects(wrongKey.initialize(), /无法解密/);
  const oversized = new Games(f.directory, 'test-secret', async () => new Response(' '.repeat(4 * 1024 * 1024 + 1)));
  await oversized.initialize();
  assert.equal((await oversized.read()).games[0].state, 'unavailable');
});

test('Miyoushe dailyNote distinguishes account risk from verification challenges', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=test-cookie' });
  const original = f.source.fetch;
  // Match the production chain: successful role lookup, rejected dailyNote.
  const { gameProviders } = await import('../server/game-providers.js');
  for (const code of [5003, 1034, 10041]) {
    f.games.provider = gameProviders(async (url, options) => url.includes('dailyNote')
      ? new Response(JSON.stringify({ retcode: code, message: 'UPSTREAM-PRIVATE-DETAIL', data: null }))
      : original(url, options));
    f.advance(301000);
    const game = (await f.games.read(true)).games.find(item => item.game === 'genshin');
    assert.equal(game.state, code === 5003 ? 'restricted' : 'verification');
    assert.match(game.message, code === 5003 ? /风险/ : /验证/);
    assert.ok(!game.message.includes('UPSTREAM-PRIVATE-DETAIL'));
  }
});

test('account risk pauses automatic Miyoushe requests; explicit refresh can recover', async t => {
  const f = await fixture(t);
  await f.games.configure({ provider: 'miyoushe', credential: 'cookie=test-cookie' });
  const { gameProviders } = await import('../server/game-providers.js');
  let restricted = true, calls = 0;
  f.games.provider = gameProviders(async (url, options) => {
    calls++;
    return restricted && url.includes('dailyNote')
      ? new Response(JSON.stringify({ retcode: 5003, data: null }))
      : f.source.fetch(url, options);
  });
  assert.equal((await f.games.read()).games[0].state, 'restricted');
  const count = calls; f.advance(301000);
  await f.games.read(); assert.equal(calls, count);
  f.advance(301000); restricted = false;
  assert.equal((await f.games.read(true)).games[0].state, 'ready');
});
