import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const directory = app.store.directory, now = Math.floor(Date.now() / 1000);
  // Use the real Python writer and the Node read-only API across the SQLite boundary.
  execFileSync('python3', ['-c', `import importlib.util,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('history','deploy/status-history.py'); h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)\nfor t in range(int(sys.argv[2])-7200,int(sys.argv[2]),30):\n h.record(Path(sys.argv[1])/'history.sqlite',t,{'cpuPercent':10+(t%90),'memory':{'used':50,'total':100},'network':{'rxBytesPerSecond':4000,'txBytesPerSecond':1000}})`, directory, String(now)]);
  const snapshot = async (t, cpu) => writeFile(directory + '/status.json', JSON.stringify({ schemaVersion: 1, collectedAt: new Date(t * 1000).toISOString(), server: { cpuPercent: cpu, cpuCount: 4, memory: { used: 50, total: 100 }, disk: { available: 1000000000, total: 2000000000 }, uptimeSeconds: 86400 } }));
  await snapshot(now - 30, 25);
  const state = await app.store.read();
  const item = state.draft.modules.find(item => item.type === 'server-status');
  item.layout = { span: 12, height: 750 };
  await app.store.mutate(state.revision, value => ({ ...value, draft: { ...value.draft, modules: [item] } }));
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelector(".history-line") && window.refreshForTest');
  assert.equal(await evaluate('Boolean(document.querySelector(".module-error"))'), false);
  assert.equal(await evaluate('document.querySelectorAll(".server-spark path.history-line").length'), 4);
  const apiResult = await evaluate("fetch('api/private/history?range=7d').then(r=>r.json())");
  assert.equal(apiResult.available, true); assert.ok(apiResult.points.length > 1); assert.ok(apiResult.points[0].cpu.max > apiResult.points[0].cpu.avg);
  await evaluate(`window.historySvg=document.querySelector('.history-plot svg'); window.cpuPath=document.querySelector('.history-plot path.history-line').getAttribute('d'); document.querySelector('[data-history="live"]').click();`);
  await snapshot(now, 66);
  await evaluate('window.refreshForTest()');
  await waitFor(`document.querySelector('.server-metrics').textContent.includes('66.0%')`);
  assert.equal(await evaluate(`historySvg === document.querySelector('.history-plot svg') && cpuPath === document.querySelector('.history-plot path.history-line').getAttribute('d')`), true, 'Live status must not reset frozen charts or their SVG instance');
  await evaluate(`document.querySelector('[aria-label="历史时间范围"]').value='6h'; document.querySelector('[aria-label="历史时间范围"]').dispatchEvent(new Event('change'));`);
  await waitFor(`document.querySelector('.history-message').textContent.includes('1 分钟平均')`);
  await evaluate(`document.querySelector('[data-metric="network"]').click();`);
  assert.equal(await evaluate(`document.querySelectorAll('.history-plot path.history-line').length`), 2);
  assert.ok(await evaluate(`document.querySelector('.history-detail').textContent.includes('KB/s')`));
  await evaluate(`document.querySelector('[data-history="live"]').click()`);
  await waitFor(`document.querySelector('.history-mode').textContent.includes('实时') && document.querySelector('path.history-line')`);
  const identity = await evaluate(`historySvg === document.querySelector('.history-plot svg')`); assert.equal(identity, true);
  await waitFor(`!document.querySelector('.history-message').textContent.includes('正在')`);
  await evaluate(`document.querySelector('.module-slot').style.transform='translateY(-10000px)'`);
  await evaluate('new Promise(resolve => setTimeout(resolve, 150))');
  const requestsBefore = await evaluate(`performance.getEntriesByType('resource').filter(row=>row.name.includes('/api/private/history')).length`);
  await snapshot(now + 1, 67); await evaluate('window.refreshForTest()');
  await waitFor(`document.querySelector('.server-metrics').textContent.includes('67.0%')`);
  assert.equal(await evaluate(`performance.getEntriesByType('resource').filter(row=>row.name.includes('/api/private/history')).length`), requestsBefore, 'Offscreen charts must not poll history');
  await evaluate(`document.querySelector('.module-slot').style.transform=''`);
  await waitFor(`performance.getEntriesByType('resource').filter(row=>row.name.includes('/api/private/history')).length > ${requestsBefore}`);

  if (process.env.MOSAIC_REVIEW_DIR) {
    await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true });
    await writeFile(process.env.MOSAIC_REVIEW_DIR + '/history-desktop.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor('document.querySelector(".mosaic-sidebar").getBoundingClientRect().right <= 1');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/history-mobile.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  console.log('History: real collector/API, averages/peaks, frozen range, live return, stable SVG, network series and mobile layout verified');
});
