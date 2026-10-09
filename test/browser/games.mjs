import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
import { gameFetchFixture } from '../fixtures/games.js';
const source = gameFetchFixture();
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  const module = state.draft.modules.find(item => item.type === 'game-status');
  state.draft.modules = [module]; await app.store.mutate(state.revision, current => ({ ...current, draft: state.draft }));
  await command('Page.navigate', { url: base + '/private' });
  await waitFor(`document.querySelectorAll('.games-game[data-state=unbound]').length===3`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-state=unbound]').length`), 3);
  await evaluate(`document.querySelector('.games-binding').open=true; const forms=document.querySelectorAll('.games-bind-form'); forms[0].querySelector('input').value='cookie=test-cookie'; forms[0].requestSubmit()`);
  await waitFor(`document.querySelector('[data-game=genshin]').dataset.state==='ready'`);
  assert.equal(await evaluate(`document.querySelector('.games-bind-form input').value`), '');
  assert.equal(await evaluate(`document.querySelector('[data-game=genshin] .games-player').textContent.includes('<script>')`), true);
  assert.equal(await evaluate(`document.querySelector('[data-game=genshin] script')===null`), true);
  await evaluate(`document.querySelectorAll('.games-bind-form')[1].querySelector('input').value='test-cred-secret'; document.querySelectorAll('.games-bind-form')[1].requestSubmit()`);
  await waitFor(`document.querySelectorAll('[data-state=ready]').length===3`);
  const count = source.calls.length;
  await evaluate(`document.querySelector('.games-header button').click()`);
  await waitFor(`!document.querySelector('.games-header button').disabled`);
  assert.equal(source.calls.length, count);
  await evaluate(`document.querySelector('.games-binding').open=false`);
  await waitFor(`[...document.querySelectorAll('.games-module img')].every(img=>img.complete && img.naturalWidth>0)`);
  if (process.env.MOSAIC_REVIEW_DIR) { await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true }); await writeFile(process.env.MOSAIC_REVIEW_DIR + '/games-desktop.png', Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64')); }
  if (process.env.MOSAIC_REVIEW_DIR) {
    await evaluate(`document.documentElement.dataset.theme='light'`);
    await writeFile(process.env.MOSAIC_REVIEW_DIR + '/games-light.png', Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
    await evaluate(`document.documentElement.dataset.theme='dark'`);
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.mosaic-sidebar').getBoundingClientRect().right<=1`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.games-game')].every(item=>item.scrollWidth<=item.clientWidth+1)`), true);
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/games-mobile.png', Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
  await evaluate(`document.querySelector('.games-binding').open=true; document.querySelectorAll('.games-bind-form')[1].querySelector('button[type=button]').click()`);
  await waitFor(`document.querySelector('[data-game=endfield]').dataset.state==='unbound'`);
  assert.equal(await evaluate(`document.querySelector('[data-game=endfield] .games-energy').textContent.includes('200')`), false);
  console.log('Game cards: binding, three providers, escaped names, refresh cooldown, mobile layout and disconnect verified.');
}, { gameFetch: source.fetch });
