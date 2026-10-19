import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
import { mergePlan } from '../../modules/study/plan.js';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  let next = 0;
  const imported = { topics: [
    { name: '渲染管线、Early-Z、MVP', level: 3, star: false, note: 'LearnOpenGL 阶段', gap: 'Z-Prepass 的取舍' },
    { name: 'CSM', level: 0, star: false, note: '', gap: '至少要能讲原理' },
    { name: '渲染方程、BRDF、PBR', level: 1, star: false, note: '仓库里是 AI 写的', gap: '必须自己学透，最好重写直接光照部分' },
    { name: 'DDGI', level: 0, star: true, note: '', gap: '你的深度项目' },
    { name: '遮挡剔除、半透明、合批', level: 2, star: false, note: '半透明你做过', gap: '能讲 Hi-Z、Occlusion Query' },
  ], resources: [{ title: 'GAMES202', note: '实时 GI 章节会把 RSM、SSDO、VXGI、SSR 讲一遍', url: 'https://example.com/games202' }, { title: 'DDGI 论文', note: 'Majercik et al. 2019', url: '' }] };
  const plan = mergePlan({ title: '图形学面试', topics: [], resources: [] }, imported, () => `t${next++}`);
  const todo = { title: '今天', items: [] };
  const page = { title: '学习', modules: [
    { id: 'plan', type: 'study', audience: 'private', visible: false, layout: { span: 12 }, data: plan },
    { id: 'tasks', type: 'todo', audience: 'private', visible: false, layout: { span: 6 }, data: todo },
  ] };
  await app.store.mutate(state.revision, s => ({ ...s, draft: page }));
  const saved = async id => (await app.store.read()).draft.modules.find(item => item.id === id).data;
  const names = () => evaluate(`[...document.querySelectorAll('.study-topic:not([hidden]) .study-name strong')].map(node => node.textContent)`);
  const row = name => `[...document.querySelectorAll('.study-topic')].find(node => node.querySelector('strong').textContent === '${name}')`;
  const act = async (script, selector = '.study-status') => { await evaluate(`document.querySelector('${selector}').textContent = ''; { ${script} }`); await waitFor(`document.querySelector('${selector}').textContent === '已更新草稿'`); };
  const shot = async name => { if (!process.env.MOSAIC_REVIEW_DIR) return; await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true }); await writeFile(`${process.env.MOSAIC_REVIEW_DIR}/${name}.png`, Buffer.from((await command('Page.captureScreenshot')).data, 'base64')); };

  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".study-topic").length === 5 && document.querySelector(".todo-module")');
  // The starred topic leads; the strip and the count describe the plan.
  assert.deepEqual(await names(), ['DDGI', '渲染管线、Early-Z、MVP', 'CSM', '渲染方程、BRDF、PBR', '遮挡剔除、半透明、合批']);
  assert.equal(await evaluate(`document.querySelector('.study-count').textContent`), '能讲透 0 · 实现过 1 · 共 5 项');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.study-bar span')].map(span => span.style.flexGrow)`), ['2', '1', '1', '1', '0']);
  assert.deepEqual(await evaluate(`[${row('渲染方程、BRDF、PBR')}.querySelectorAll('.study-cell.is-filled').length, ${row('渲染方程、BRDF、PBR')}.querySelector('.study-level').textContent]`), [1, 'AI 写的']);
  await shot('study');

  // A meter cell sets the level; pressing the top filled cell steps back one.
  await act(`${row('CSM')}.querySelectorAll('.study-cell')[3].click()`);
  assert.equal((await saved('plan')).topics.find(topic => topic.name === 'CSM').level, 4);
  await act(`${row('CSM')}.querySelectorAll('.study-cell')[3].click()`);
  assert.equal((await saved('plan')).topics.find(topic => topic.name === 'CSM').level, 3);
  await act(`${row('CSM')}.querySelector('.study-star').click()`);
  assert.deepEqual((await names()).slice(0, 2), ['CSM', 'DDGI'], 'Starred topics keep their order in the plan');
  // The filter only hides what is already mastered and is never saved.
  await evaluate(`document.querySelector('.study-filter').click()`);
  assert.deepEqual(await names(), ['DDGI', '渲染方程、BRDF、PBR', '遮挡剔除、半透明、合批']);
  await evaluate(`document.querySelector('.study-filter').click()`);
  assert.equal((await names()).length, 5);
  await act(`document.querySelector('.study-resource input').click()`);
  assert.equal((await saved('plan')).resources[0].done, true);
  assert.equal(await evaluate(`document.querySelector('.study-resource').classList.contains('done')`), true);

  // What a topic still needs goes to the todo module on the same page.
  const box = await evaluate(`(() => { const r = document.querySelector('.study-module').getBoundingClientRect(); return { x: r.x + 40, y: r.y + 40 }; })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await waitFor(`document.querySelector('.study-module').classList.contains('has-todo')`);
  await act(`${row('渲染方程、BRDF、PBR')}.querySelector('.study-todo').click()`, '.todo-status');
  assert.deepEqual((await saved('tasks')).items.map(item => item.text), ['渲染方程、BRDF、PBR：必须自己学透，最好重写直接光照部分']);
  assert.equal(await evaluate(`${row('渲染方程、BRDF、PBR')}.querySelector('.study-todo').textContent`), '已加入 ✓');
  await shot('study-handoff');

  // Without a todo module the offer is gone.
  const current = await app.store.read();
  await app.store.mutate(current.revision, s => ({ ...s, draft: { ...s.draft, modules: s.draft.modules.filter(item => item.id !== 'tasks') } }));
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".study-topic").length === 5');
  assert.equal(await evaluate(`document.querySelector('.study-module').classList.contains('has-todo')`), false);

  // Pasting in the editor adds new rows and keeps the progress of known ones.
  await command('Page.navigate', { url: base + '/edit' });
  await waitFor('document.querySelector("[data-module-id=plan] .module-edit-button")');
  await evaluate(`document.querySelector('[data-module-id="plan"] .module-edit-button').click()`);
  await waitFor('document.querySelector("#module-editor").open && document.querySelector(".study-import textarea")');
  await evaluate(`document.querySelector('.study-import textarea').value = '| 清单项 | 现状 | 要补的 |\\n|---|---|---|\\n| CSM | ❌ | 别覆盖 |\\n| TAA 拖影 | ❌ | 降噪练习里的时域部分 |\\n\\n1. **RTXGI**：参考答案'; [...document.querySelectorAll('.study-import button')].find(b => b.textContent === '导入').click()`);
  await waitFor(`document.querySelectorAll('#preview-page .study-topic').length === 6`);
  await evaluate(`document.querySelector('#save-module').click()`);
  await waitFor('!document.querySelector("#module-editor").open');
  const merged = await saved('plan');
  assert.deepEqual([merged.topics.find(topic => topic.name === 'CSM').level, merged.topics.at(-1).name, merged.resources.at(-1).title], [3, 'TAA 拖影', 'RTXGI']);

  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".study-topic").length === 6');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  await new Promise(resolve => setTimeout(resolve, 800));
  await shot('study-narrow');
  console.log('Study: ordering, levels, stars, filter, reading, todo handoff and paste import verified');
});
