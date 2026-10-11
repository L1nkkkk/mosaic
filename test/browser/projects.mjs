import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  const data = { title: '在做的项目', projects: [
    { id: 'engine', name: '渲染引擎', summary: '一个用来学习的实时渲染器。', url: 'https://example.com/engine', stage: 'building', accent: 'cyan', paused: false, note: 'INTERNAL-NOTE', milestones: [{ text: '前向渲染', done: true }, { text: '阴影', done: false }, { text: 'SECRET-MILESTONE', done: false, private: true }] },
    { id: 'site', name: '个人主页', summary: '', url: '', stage: 'shipped', accent: 'amber', paused: false, note: '', milestones: [{ text: '上线', done: true }] },
  ] };
  const page = { title: 'Mosaic · 项目', modules: [{ id: 'work', type: 'projects', audience: 'public', visible: true, live: true, layout: { span: 12 }, data }] };
  await app.store.mutate(state.revision, s => ({ ...s, draft: page, published: page }));
  const shot = async name => { if (process.env.MOSAIC_REVIEW_DIR) { await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true }); await writeFile(process.env.MOSAIC_REVIEW_DIR + `/${name}.png`, Buffer.from((await command('Page.captureScreenshot')).data, 'base64')); } };
  const visitor = () => evaluate(`fetch('api/page').then(r => r.text())`);

  // Visitors get the overall count but neither the note nor the private milestone.
  await command('Page.navigate', { url: base + '/' });
  await waitFor('document.querySelectorAll(".pj").length===2');
  const text = await visitor();
  assert.ok(!text.includes('INTERNAL-NOTE') && !text.includes('SECRET-MILESTONE'));
  assert.equal(await evaluate(`document.querySelector('.pj .pj-count').textContent`), '1/3');
  assert.equal(await evaluate(`document.querySelectorAll('.pj[open] .pj-miles li').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('.projects-module input,.projects-module textarea,.projects-module button').length`), 0);
  assert.equal(await evaluate(`document.querySelector('.pj-link').href`), 'https://example.com/engine');
  // Opening one project closes the other.
  await evaluate(`document.querySelectorAll('.pj>summary')[1].click()`);
  await waitFor(`document.querySelectorAll('.pj[open]').length===1 && document.querySelectorAll('.pj')[1].open`);
  await evaluate(`document.querySelectorAll('.pj>summary')[0].click()`);
  await shot('projects-public');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await waitFor('document.documentElement.scrollWidth<=innerWidth');
  await shot('projects-public-mobile');
  await command('Emulation.clearDeviceMetricsOverride');

  // The workspace edits in place, and a live module reaches visitors without publishing.
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".pj[open] .pj-miles li").length===3');
  assert.equal(await evaluate(`document.querySelector('.pj-note textarea').value`), 'INTERNAL-NOTE');
  await evaluate(`document.querySelector('[data-mile="1"]').click()`);
  await waitFor(`document.querySelector('.pj .pj-count').textContent==='2/3' && document.querySelector('.pj').querySelectorAll('.pj-track i.on').length===2`);
  assert.equal(await evaluate(`document.querySelector('.pj').open`), true);
  await evaluate(`(() => { const form = document.querySelector('.pj-add'); form.elements.mile.value = '后处理'; form.requestSubmit(); })()`);
  await waitFor(`document.querySelectorAll('.pj[open] .pj-miles li').length===4 && document.activeElement===document.querySelector('.pj[open] .pj-add input')`);
  await evaluate(`document.querySelector('[data-lock="3"]').click()`);
  await waitFor(`document.querySelector('[data-lock="3"]')?.getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.querySelector('[data-stage="polishing"]').click()`);
  await waitFor(`document.querySelector('.pj-pipeline .now button')?.dataset.stage==='polishing'`);
  await shot('projects-private');
  const live = JSON.parse(await visitor()).page.modules[0].data.projects[0];
  assert.deepEqual(live.progress, { done: 2, total: 4 });
  assert.equal(live.stage, 'polishing');
  assert.deepEqual(live.milestones.map(item => item.text), ['前向渲染', '阴影']);
  assert.equal(live.note, '');

  // The editor's Public preview shows the reduced view; text editing round-trips milestones.
  await command('Page.navigate', { url: base + '/edit' });
  await waitFor('document.querySelectorAll("#preview-page .pj").length===2');
  await evaluate(`document.querySelector('#public-preview').click()`);
  await waitFor(`document.querySelectorAll('#preview-page .pj[open] .pj-miles li').length===2 && !document.querySelector('#preview-page .pj-note')`);
  await evaluate(`document.querySelector('[data-module-id="work"] .module-edit-button').click()`);
  await waitFor('document.querySelector("#module-editor").open');
  assert.equal(await evaluate(`[...document.querySelectorAll('#module-fields textarea')][0].value`), '[x] 前向渲染\n[x] 阴影\n[ ] SECRET-MILESTONE #私\n[ ] 后处理 #私');
  await evaluate(`(() => { const area = document.querySelector('#module-fields textarea'); area.value = '[x] 前向渲染\\n新的一步\\n[ ] 只给自己 🔒'; area.dispatchEvent(new Event('input')); })()`);
  await evaluate(`document.querySelector('#save-module').click()`);
  await waitFor('!document.querySelector("#module-editor").open');
  assert.deepEqual((await app.store.read()).draft.modules[0].data.projects[0].milestones, [{ text: '前向渲染', done: true }, { text: '新的一步', done: false }, { text: '只给自己', done: false, private: true }]);
  console.log('Projects: public reduction, accordion, workspace milestones, visibility toggle, stage, live publishing, editor text round-trip and mobile width verified');
});
