import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const original = await app.store.read();
  if (process.env.MOSAIC_REVIEW_DIR) await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true });
  await command('Page.navigate', { url: base + '/' });
  await waitFor('document.querySelector("#appearance-settings")');
  assert.equal(await evaluate('Boolean(document.querySelector(".sidebar-brand,.sidebar-note,.dashboard-intro>p"))'), false);
  const loaded = await evaluate("performance.getEntriesByType('resource').map(row=>row.name)");
  for (const unused of ['/modules/server-status/', '/modules/bot-status/', '/web/lab.js', '/web/arrange.js']) assert.ok(!loaded.some(url => url.includes(unused)), `Reader should not load ${unused}`);
  await evaluate("document.querySelector('#appearance-settings').click()");
  await waitFor("document.querySelector('#background-controls')?.disabled === false");
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/settings.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  // Real file input → browser resize/WebP encode → authenticated upload → disk.
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
    const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0,0,2400,1600); gradient.addColorStop(0,'#42247b'); gradient.addColorStop(1,'#c36872'); ctx.fillStyle=gradient; ctx.fillRect(0,0,2400,1600);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test.png', {type:'image/png'}));
    document.querySelector('#background-file').files=transfer.files; document.querySelector('#background-file').dispatchEvent(new Event('change'));
  })()`);
  await waitFor("document.querySelector('#background-status').textContent.includes('已保存')");
  const saved = await app.appearance.read();
  assert.match(saved.background, /^[a-f0-9]{64}\.webp$/);
  await app.appearance.initialize();
  const publicState = await (await fetch(base + '/api/appearance')).json();
  const image = await fetch(base + '/' + publicState.backgroundUrl);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.ok(Number(image.headers.get('content-length')) < 512 * 1024);
  assert.match(image.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/' + publicState.backgroundUrl, { headers: { 'If-None-Match': image.headers.get('etag') } })).status, 304);
  assert.equal(await evaluate(`(async()=>{const img=new Image(); img.src=${JSON.stringify(base + '/' + publicState.backgroundUrl)}; await img.decode(); return img.naturalWidth;})()`), 1920);
  // A stale settings dialog must not silently overwrite an update from another tab.
  await app.appearance.save(saved.revision, 'none');
  await evaluate("document.querySelector('#background-default').click()");
  await waitFor("document.querySelector('#background-status').textContent.includes('其他窗口')");
  assert.equal((await app.appearance.read()).background, 'none');
  await evaluate("document.querySelector('#background-default').click()");
  await waitFor("document.querySelector('#background-status').textContent.includes('已保存')");
  assert.equal((await app.appearance.read()).background, 'default');
  const next = await app.appearance.read();
  const bytes = Buffer.from(await image.arrayBuffer());
  await app.appearance.save(next.revision, null, bytes);
  // Anonymous fresh visitors see the persisted background before loading app JS.
  await command('Network.clearBrowserCookies');
  await command('Page.navigate', { url: base + '/' });
  await waitFor("document.querySelector('#appearance-settings')");
  assert.ok(await evaluate(`getComputedStyle(document.body,'::before').backgroundImage.includes(${JSON.stringify(saved.background)})`));
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(row => row.name.includes('api/appearance'))"), false, 'Initial background should not wait for another API request');
  await evaluate("document.querySelector('#appearance-settings').click()");
  await waitFor("document.querySelector('#appearance-login')?.hidden === false");
  assert.equal(await evaluate("document.querySelector('#background-controls').hidden"), true);
  assert.deepEqual(await app.store.read(), original);
  if (process.env.MOSAIC_REVIEW_DIR) {
    await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true });
    await evaluate("document.querySelector('#appearance-dialog button').click()");
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await writeFile(process.env.MOSAIC_REVIEW_DIR + '/desktop.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await waitFor('document.querySelector(".mosaic-sidebar").getBoundingClientRect().right <= 1');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await writeFile(process.env.MOSAIC_REVIEW_DIR + '/mobile.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  }
  console.log('Appearance: upload/compression, public visibility, owner-only controls, conflicts, reset and page isolation verified');
});
