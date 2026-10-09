import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
import { gameFetchFixture } from '../fixtures/games.js';
import { qrFetchFixture } from '../fixtures/game-qr.js';
const source = gameFetchFixture(), qr = qrFetchFixture();
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read(); state.draft.modules = state.draft.modules.filter(item => item.type === 'game-status');
  await app.store.mutate(state.revision, current => ({ ...current, draft: state.draft }));
  await command('Page.navigate', { url: base + '/private' });
  await waitFor(`document.querySelector('.games-binding')`);
  await evaluate(`document.querySelector('.games-binding').open=true; document.querySelector('.games-qr-actions button').click()`);
  await waitFor(`document.querySelector('.games-qr-image').naturalWidth>0`);
  assert.equal(await evaluate(`document.querySelector('.games-qr-image').src.startsWith('data:image/png')`), true);
  assert.equal(await evaluate(`document.querySelector('.games-manual').open`), false);
  if (process.env.MOSAIC_REVIEW_DIR) {
    await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true });
    await writeFile(process.env.MOSAIC_REVIEW_DIR + '/games-qr-desktop.png', Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.mosaic-sidebar').getBoundingClientRect().right<=1`);
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/games-qr-mobile.png', Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
  qr.scanned = true;
  await waitFor(`document.querySelector('.games-qr-status').textContent.includes('已扫码')`);
  qr.confirmed = true;
  await waitFor(`document.querySelector('[data-game=genshin]').dataset.state==='ready'`);
  assert.equal(await evaluate(`document.querySelector('.games-qr-image').hidden`), true);
  await evaluate(`document.querySelector('.games-qr-actions button:nth-child(2)').click()`);
  await waitFor(`document.querySelector('[data-game=endfield]').dataset.state==='ready'`);
  assert.ok(!await evaluate(`document.body.textContent.includes('secret-skland-cred')`));
  await evaluate(`document.querySelector('.games-binding').open=false`);
  await waitFor(`document.querySelector('.games-qr-panel').hidden`);
  console.log('QR UI: local image, mobile layout, scanned state, both confirmed bindings and close verified.');
}, { gameFetch: source.fetch, gameQrFetch: qr.fetch });
