import assert from 'node:assert/strict';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({ base, command, evaluate, waitFor }) => {
  // The test checks what the module asks the frame to load; no real site is contacted.
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['https://*'] });
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelector(".browser-module .browser-notice")');
  const card = 'document.querySelector(".browser-module")';
  assert.equal(await evaluate(`${card}.querySelector("iframe")`), null);
  assert.match(await evaluate(`${card}.querySelector(".browser-notice").textContent`), /扩展/);
  assert.equal(await evaluate(`${card}.querySelector(".browser-open").href`), 'https://www.bilibili.com/');

  // The extension announces itself by marking the page after the module has mounted.
  await evaluate('document.documentElement.dataset.mosaicBrowser = "test"');
  await waitFor(`${card}.querySelector("iframe")`);
  const frame = `${card}.querySelector("iframe")`;
  assert.equal(await evaluate(`${frame}.src`), 'https://www.bilibili.com/');
  const sandbox = await evaluate(`${frame}.getAttribute("sandbox")`);
  assert.ok(sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin'));
  assert.ok(!sandbox.includes('allow-top-navigation'), 'A framed site must not navigate the Mosaic page');
  assert.match(await evaluate(`${frame}.allow`), /fullscreen/);

  const go = value => evaluate(`(() => { const form = ${card}.querySelector("form"); form.elements.address.value = ${JSON.stringify(value)}; form.requestSubmit(); return ${frame}.src; })()`);
  assert.equal(await go('example.com/a'), 'https://example.com/a');
  assert.equal(await go('两个 词'), 'https://www.bing.com/search?q=' + encodeURIComponent('两个 词'));
  const press = action => evaluate(`(() => { ${card}.querySelector('[data-action="${action}"]').click(); return ${frame}.src; })()`);
  assert.equal(await press('back'), 'https://example.com/a');
  assert.equal(await press('back'), 'https://www.bilibili.com/');
  assert.equal(await evaluate(`${card}.querySelector('[data-action="back"]').disabled`), true);
  assert.equal(await press('forward'), 'https://example.com/a');
  assert.equal(await evaluate(`${card}.querySelector(".browser-marks button").textContent`), '哔哩哔哩');

  // Messages are only honoured from the module's own frame.
  await evaluate('window.postMessage({ mosaicBrowser: 1, type: "navigated", url: "https://evil.test/" }, "*")');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate(`${card}.querySelector("form").elements.address.value`), 'https://example.com/a');

  // A fixed zoom lays the page out larger than the card and scales it back to fit exactly.
  const zoomed = value => evaluate(`(() => { const select = ${card}.querySelector("select"); select.value = "${value}"; select.dispatchEvent(new Event("change")); const view = ${card}.querySelector(".browser-view").getBoundingClientRect(), box = ${frame}.getBoundingClientRect(); return { layout: ${frame}.clientWidth / view.width, fills: Math.abs(box.width - view.width) < 1 && Math.abs(box.height - view.height) < 1 }; })()`);
  const half = await zoomed('0.5');
  assert.ok(Math.abs(half.layout - 2) < 0.01 && half.fills, JSON.stringify(half));
  // Fitting leaves a wide card close to full size and shows a narrow card a desktop-width page.
  const wide = await zoomed('0');
  assert.ok(wide.layout < 1.1 && wide.fills, JSON.stringify(wide));
  await command('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(`${frame}.clientWidth > 1000`);
  const narrow = await zoomed('0');
  assert.ok(narrow.fills && narrow.layout > 1.5, JSON.stringify(narrow));
  await command('Emulation.clearDeviceMetricsOverride');
  await zoomed('0.75');

  // The last address and the zoom survive a reload of the Mosaic page.
  await evaluate('window.beforeReload = true');
  await command('Page.reload');
  await waitFor('!window.beforeReload && document.querySelector(".browser-module .browser-open")');
  assert.equal(await evaluate(`${card}.querySelector(".browser-open").href`), 'https://example.com/a');
  assert.equal(await evaluate(`${card}.querySelector("select").value`), '0.75');
  console.log('Browser module: extension gate, sandbox, address bar, history and zoom verified.');
});
