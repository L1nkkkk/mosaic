import assert from 'node:assert/strict';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const initial = await app.store.read();
  const item = (type, id, height) => ({ id, type, audience: 'public', visible: true, layout: { span: 6, height }, data: structuredClone(app.registry.get(type).meta.defaultData) });
  const page = { title: 'Runtime test', modules: [item('todo', 'tasks', 360), item('shader', 'colors', 420), item('note', 'text', 260), item('todo', 'tasks-two', 360)] };
  await app.store.mutate(initial.revision, state => ({ ...state, draft: page, published: structuredClone(page) }));
  const navigate = async route => { await command('Page.navigate', { url: base + route }); };
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await navigate('/edit');
  await waitFor('document.querySelectorAll(".module-slot").length === 4 && document.querySelector("canvas")');
  await settle();
  await evaluate(`window.savedCanvas = document.querySelector('canvas'); window.savedInput = document.querySelector('.todo-module form input'); savedInput.value = '尚未提交的输入'; savedInput.focus();`);
  // Change content, reorder and resize via actual editor keyboard controls.
  await evaluate(`document.querySelector('[data-module-id="colors"] [data-layout-action="move"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); document.querySelector('[data-module-id="colors"] [data-layout-action="resize"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); window.refreshForTest();`);
  await settle();
  assert.deepEqual(await evaluate(`({ canvas: savedCanvas === document.querySelector('canvas'), input: savedInput === document.querySelector('.todo-module form input'), value: savedInput.value, first: document.querySelector('#preview-page').firstElementChild.dataset.moduleId, height: document.querySelector('canvas').height })`), { canvas: true, input: true, value: '尚未提交的输入', first: 'colors', height: 440 });
  assert.ok(await evaluate(`Boolean(savedCanvas.getContext('webgl')?.getParameter(savedCanvas.getContext('webgl').CURRENT_PROGRAM))`), 'Real shader must link and render, not silently fall back');
  await evaluate(`document.querySelector('select[aria-label="页面排列"]').value = 'masonry'; document.querySelector('select[aria-label="页面排列"]').dispatchEvent(new Event('change'));`);
  await settle();
  const boxes = await evaluate(`[...document.querySelectorAll('#preview-page>.module-slot')].map(slot => { const box = slot.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })`);
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const x = boxes[a], y = boxes[b];
    assert.ok(x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1, 'Masonry cards must never overlap');
  }
  await evaluate(`document.querySelector('#narrow-preview').click()`); await settle();
  assert.ok(await evaluate(`document.querySelector('#preview-page').scrollWidth <= document.querySelector('#preview-page').clientWidth + 1`), 'Narrow layout must fit');
  assert.equal(await evaluate(`savedCanvas === document.querySelector('canvas')`), true);
  // Editing a todo updates local draft only, then the normal save button persists.
  await evaluate(`document.querySelector('[data-module-id="tasks"] input[type="checkbox"]').click()`);
  await waitFor(`document.querySelector('[data-module-id="tasks"] .todo-status').textContent === '已更新草稿'`);
  assert.equal((await app.store.read()).draft.modules[0].data.items[0].done, false);
  await evaluate(`document.querySelector('#save-draft').click()`);
  await waitFor(`document.querySelector('#save-status').textContent === '草稿已保存'`);
  assert.equal((await app.store.read()).draft.modules.find(item => item.id === 'tasks').data.items[0].done, true);
  assert.equal((await app.store.read()).published.modules[0].data.items[0].done, false);
  console.log('Editor: shader/input identity, resize, reorder, masonry, narrow layout and local draft isolation verified');

  await navigate('/private');
  await waitFor('document.querySelector(".todo-module") && window.refreshForTest');
  await evaluate(`document.querySelector('[data-module-id="tasks"] input[type="checkbox"]').click()`);
  await waitFor(`document.querySelector('[data-module-id="tasks"] .todo-status').textContent === '已更新草稿'`);
  assert.equal((await app.store.read()).draft.modules.find(item => item.id === 'tasks').data.items[0].done, false);
  const remote = await app.store.read();
  await app.store.mutate(remote.revision, state => { state.draft.modules.find(item => item.id === 'tasks').data.title = 'Changed elsewhere'; return state; });
  await evaluate(`document.querySelector('[data-module-id="tasks"] input[type="checkbox"]').click()`);
  await waitFor(`document.querySelector('[data-module-id="tasks"] .todo-status').textContent.includes('其他窗口')`);
  assert.equal((await app.store.read()).draft.modules.find(item => item.id === 'tasks').data.title, 'Changed elsewhere');
  assert.equal((await app.store.read()).draft.modules.find(item => item.id === 'tasks').data.items[0].done, false);
  await navigate('/');
  await waitFor('document.querySelector(".todo-module")');
  assert.equal(await evaluate(`document.querySelector('.todo-module input[type="checkbox"]').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.todo-module form').hidden`), true);
  console.log('Private interactions persist; public interactions remain read-only');
  // The shell filters without disposing live modules and stores appearance locally.
  await evaluate(`window.searchCanvas = document.querySelector('canvas'); document.querySelector('#toggle-search').click(); document.querySelector('#module-search').value='no-such-module-xyz'; document.querySelector('#module-search').dispatchEvent(new Event('input'));`);
  assert.equal(await evaluate(`document.querySelectorAll('#public-page>.module-slot:not([hidden])').length`), 0);
  await evaluate(`document.querySelector('#module-search').value=''; document.querySelector('#module-search').dispatchEvent(new Event('input')); document.querySelector('[data-theme-toggle]').click();`);
  await settle();
  assert.equal(await evaluate(`searchCanvas === document.querySelector('canvas')`), true);
  assert.equal(await evaluate(`document.documentElement.dataset.theme`), 'light');
  await command('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:false });
  await settle();
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.equal(await evaluate(`document.querySelector('.mosaic-sidebar').inert`), true);
  await evaluate(`document.querySelector('.shell-menu').click()`);
  assert.equal(await evaluate(`document.querySelector('.mosaic-main').inert && !document.querySelector('.mosaic-sidebar').inert`), true);
  await evaluate(`document.querySelector('.mosaic-sidebar a').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`!document.querySelector('.mosaic-main').inert && document.querySelector('.mosaic-sidebar').inert`), true);
  await command('Emulation.setDeviceMetricsOverride', { width:1440, height:1000, deviceScaleFactor:1, mobile:false });
  await settle();
  await evaluate(`document.querySelector('#appearance-settings').click(); document.querySelector('#wallpaper-choice').click(); document.querySelector('#appearance-dialog button').click()`);
  assert.equal(await evaluate(`document.documentElement.dataset.wallpaper`), 'off');
  console.log('Shell: search preserves instances, themes work, mobile navigation is accessible and the layout fits');


  // Exercise lifecycle isolation directly in a real browser, with observable hooks.
  const result = await evaluate(`(async () => {
    const { createModuleHost } = await import('/web/runtime.js');
    const container = document.createElement('div'); container.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:160px;z-index:999'; document.body.append(container);
    const counts = { mount:0, update:0, resize:0, frame:0, dispose:0, active:[] }; let signal;
    const module = { meta: { animation:'continuous', isolation:'shadow', id:'todo' }, mount(ctx) { counts.mount++; signal=ctx.signal; ctx.root.append(document.createElement('canvas')); return { update(){counts.update++}, resize(){counts.resize++}, frame(){counts.frame++}, setActive(value){counts.active.push(value)}, dispose(){counts.dispose++} }; } };
    const options = { id:'fixture', data:{value:1}, writable:false };
    const host = createModuleHost(container, module, options);
    await new Promise(resolve => setTimeout(resolve, 120));
    host.update({...options}); host.update({...options,data:{value:2}});
    container.style.width = '240px'; await new Promise(resolve => setTimeout(resolve, 80));
    const size = host.inspect().size;
    host.pause(true); const paused = counts.frame; await new Promise(resolve => setTimeout(resolve, 80)); const pausedStill = counts.frame === paused;
    host.pause(false); await new Promise(resolve => setTimeout(resolve, 80));
    container.style.top='-10000px'; await new Promise(resolve => setTimeout(resolve, 80)); const hidden = counts.frame; await new Promise(resolve => setTimeout(resolve, 80)); const offscreenStill = counts.frame === hidden;
    host.dispose(); host.dispose(); const ended = counts.frame; await new Promise(resolve => setTimeout(resolve, 80));
    container.remove();
    return { counts, size, pausedStill, offscreenStill, disposedStill: counts.frame === ended, aborted:signal.aborted };
  })()`);
  assert.equal(result.counts.mount, 1); assert.equal(result.counts.update, 2); assert.equal(result.counts.dispose, 1);
  assert.ok(result.counts.resize >= 2); assert.equal(result.size.width, 240);
  assert.ok(result.counts.frame > 0); assert.ok(result.pausedStill && result.offscreenStill && result.disposedStill && result.aborted);
  console.log('Runtime: mount once, deduplicated updates, shadow root, resize, pause, offscreen and disposal verified');
  const errors = await evaluate(`(async () => {
    const { createModuleHost } = await import('/web/runtime.js');
    let cleanup = 0, goodUpdates = 0, aborted;
    const badRoot = document.createElement('div'), goodRoot = document.createElement('div'); document.body.append(badRoot, goodRoot);
    const options = { id:'bad', data:{}, writable:false };
    const bad = createModuleHost(badRoot, { meta:{animation:'continuous'}, mount(ctx) { aborted=ctx.signal; return { update(){throw new Error('fixture failure')}, dispose(){cleanup++} }; } }, options);
    const good = createModuleHost(goodRoot, { meta:{}, mount(){return { update(){goodUpdates++} }; } }, options);
    good.update({...options,data:{newValue:1}}); const state=bad.inspect(); bad.dispose(); good.dispose(); badRoot.remove(); goodRoot.remove();
    return {cleanup,goodUpdates,failed:state.failed,active:state.active,aborted:aborted.aborted};
  })()`);
  assert.deepEqual(errors, {cleanup:1,goodUpdates:2,failed:true,active:false,aborted:true});
  console.log('Runtime: lifecycle failure cleans up once and does not interrupt adjacent modules');


  await navigate('/lab');
  await waitFor('document.querySelector("#lab-state")?.textContent.includes("mounted")');
  assert.equal(await evaluate(`document.documentElement.dataset.theme`), 'light');
  assert.equal(await evaluate(`document.documentElement.dataset.wallpaper`), 'off');
  const beforeLab = await app.store.read();
  await evaluate(`document.querySelector('.todo-module input[type="checkbox"]').click()`);
  await waitFor(`document.querySelector('.todo-status').textContent === '已更新草稿'`);
  assert.deepEqual(await app.store.read(), beforeLab);
  await evaluate(`document.querySelector('#lab-module').value='shader'; document.querySelector('#lab-module').dispatchEvent(new Event('change'));`);
  await waitFor('document.querySelector("canvas")');
  await evaluate(`window.labCanvas = document.querySelector('canvas'); document.querySelector('#lab-width').value='320'; document.querySelector('#lab-width').dispatchEvent(new Event('input')); document.querySelector('#lab-paused').click();`);
  await settle();
  assert.equal(await evaluate(`labCanvas === document.querySelector('canvas') && labCanvas.width === 320`), true);
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await waitFor(`document.querySelector('#lab-state').textContent.includes('"reducedMotion": true')`);
  await command('Network.clearBrowserCookies');
  await navigate('/lab'); await waitFor('document.querySelector("#login-form")');
  assert.equal(await evaluate('Boolean(document.querySelector("#lab-module"))'), false);
  console.log('Lab: ephemeral saves, real shader, resize, reduced motion and login gate verified');
});
