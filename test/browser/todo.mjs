import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
import { today } from '../../modules/todo/items.js';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read(), now = new Date(), day = today(now), shifted = days => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const items = [
    { id: 'report', text: '写周报', done: false, due: shifted(-1) }, { id: 'milk', text: '买牛奶', done: false, due: day },
    { id: 'long', text: '把这一条写得很长很长，长到在窄一点的卡片里一定会换行，用来确认换行以后每一行仍然落在横线上', done: false },
    { id: 'words', text: '背单词', done: true, daily: true, doneAt: shifted(-1) },
    { id: 'parcel', text: '寄快递', done: true, doneAt: day }, { id: 'old', text: '很久以前做完的事', done: true },
  ];
  const page = { title: '待办', modules: [{ id: 'tasks', type: 'todo', audience: 'private', visible: false, layout: { span: 6 }, data: { title: '这一周', items } }] };
  await app.store.mutate(state.revision, s => ({ ...s, draft: page }));
  const saved = async () => (await app.store.read()).draft.modules[0].data.items;
  const ids = selector => evaluate(`[...document.querySelectorAll('${selector} > li')].map(row => row.dataset.id)`);
  // Every change is one save; wait for it before looking at the result.
  const act = async script => { await evaluate(`document.querySelector('.todo-status').textContent = ''; { ${script} }`); await waitFor(`document.querySelector('.todo-status').textContent === '已更新草稿'`); };
  const shot = async name => { if (!process.env.MOSAIC_REVIEW_DIR) return; await mkdir(process.env.MOSAIC_REVIEW_DIR, { recursive: true }); await writeFile(`${process.env.MOSAIC_REVIEW_DIR}/${name}.png`, Buffer.from((await command('Page.captureScreenshot')).data, 'base64')); };

  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".todo-module li").length === 6');
  // A daily task ticked yesterday is open again; finished tasks wait folded below.
  assert.deepEqual(await ids('.todo-list'), ['report', 'milk', 'long', 'words']);
  assert.deepEqual(await ids('.todo-done'), ['parcel', 'old']);
  assert.equal(await evaluate(`document.querySelector('[data-id="words"] input').checked`), false);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.todo-list li > .todo-due:not([hidden])')].map(mark => [mark.textContent, mark.dataset.state])`), [['逾期 1 天', 'late'], ['今天', 'today']]);
  assert.deepEqual(await evaluate(`[document.querySelector('.todo-tally').textContent, document.querySelector('.todo-archive summary').textContent, document.querySelector('.todo-archive').open]`), ['今日完成 1 件', '已完成 2 件', false]);
  const onGrid = `[...document.querySelectorAll('.todo-module li, .todo-head, .todo-add, .todo-status')].every(row => row.offsetHeight % 34 === 0)`;
  assert.equal(await evaluate(onGrid), true, 'Everything sits on the ruled grid');
  await evaluate(`document.querySelector('.todo-archive').open = true`);
  assert.equal(await evaluate(`new Set([...document.querySelectorAll('.todo-module li input[type=checkbox]')].map(box => box.getBoundingClientRect().x)).size`), 1, 'Finished tasks keep the same margin');
  const row = await evaluate(`(() => { const box = document.querySelector('[data-id="long"]').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + 12 }; })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y });
  await waitFor(`getComputedStyle(document.querySelector('[data-id="long"] .todo-tools')).opacity === '1'`);
  assert.equal(await evaluate(`document.querySelector('[data-id="long"] .todo-tools').offsetHeight`), 33, 'The tools cover one line, not the whole task');
  await waitFor(`getComputedStyle(document.querySelector('[data-id="long"] .todo-grip')).opacity > 0.5 && getComputedStyle(document.querySelector('[data-id="long"] .todo-grip')).backgroundImage.includes('gradient')`);
  await shot('todo');
  await evaluate(`document.querySelector('[data-theme-toggle]').click()`);
  await shot('todo-light');
  await evaluate(`document.querySelector('[data-theme-toggle]').click()`);

  // Ticking strikes the task where it stands, then it joins the finished ones; the stale daily tick is dropped on the way.
  await act(`document.querySelector('[data-id="milk"] input').click()`);
  assert.equal(await evaluate(`document.querySelector('.todo-list [data-id="milk"]')?.classList.contains('done')`), true);
  await waitFor(`document.querySelector('.todo-done [data-id="milk"]')`);
  assert.deepEqual((await saved()).filter(item => ['milk', 'words'].includes(item.id)), [{ id: 'milk', text: '买牛奶', done: true, due: day, doneAt: day }, { id: 'words', text: '背单词', done: false, daily: true }]);
  assert.equal(await evaluate(`document.querySelector('.todo-tally').textContent`), '今日完成 2 件');

  // A new task can repeat daily; the form goes back to blank afterwards.
  await act(`document.querySelector('.todo-add .todo-repeat').click(); const input = document.querySelector('.todo-add input'); input.value = '喝水'; input.focus(); document.querySelector('.todo-add').requestSubmit()`);
  const water = (await saved()).at(-1);
  assert.deepEqual({ ...water, id: '' }, { id: '', text: '喝水', done: false, daily: true });
  assert.deepEqual(await evaluate(`[document.querySelector('.todo-add input').value, document.querySelector('.todo-add .todo-repeat').getAttribute('aria-pressed'), document.activeElement === document.querySelector('.todo-add input')]`), ['', 'false', true]);
  // A date picked in the form goes with the next task, and a row's date can be changed or cleared.
  await evaluate(`{ const picker = document.querySelector('.todo-add .todo-picker'); picker.value = '${shifted(1)}'; picker.dispatchEvent(new Event('change')) }`);
  assert.equal(await evaluate(`document.querySelector('.todo-add .todo-due').textContent`), '明天');
  await act(`const input = document.querySelector('.todo-add input'); input.value = '交电费'; document.querySelector('.todo-add').requestSubmit()`);
  const electricity = (await saved()).at(-1);
  assert.equal(electricity.due, shifted(1));
  await act(`const picker = document.querySelector('[data-id="report"] .todo-picker'); picker.value = '${shifted(40)}'; picker.dispatchEvent(new Event('change'))`);
  assert.equal((await saved())[0].due, shifted(40));
  await act(`const picker = document.querySelector('[data-id="report"] .todo-picker'); picker.value = ''; picker.dispatchEvent(new Event('change'))`);
  assert.equal('due' in (await saved())[0], false);
  await act(`document.querySelector('[data-id="long"] .todo-tools .todo-repeat').click()`);
  assert.equal((await saved()).find(item => item.id === 'long').daily, true);
  await act(`document.querySelector('[data-id="long"] > .todo-repeat').click()`);
  assert.equal('daily' in (await saved()).find(item => item.id === 'long'), false);

  // Dragging by the margin dots reorders the open tasks; the finished ones keep their places in the data.
  assert.deepEqual(await ids('.todo-list'), ['report', 'long', 'words', water.id, electricity.id]);
  const centre = id => evaluate(`(() => { const box = document.querySelector('[data-id="${id}"] .todo-grip').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
  const from = await centre('words'), to = await centre('report');
  await evaluate(`document.querySelector('.todo-status').textContent = ''`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 });
  for (const step of [0.3, 0.7, 1]) await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + (to.y - from.y - 4) * step, button: 'left', buttons: 1 });
  assert.equal(await evaluate(`document.querySelector('.todo-list').classList.contains('is-sorting') && document.querySelector('[data-id="report"]').style.transform !== ''`), true);
  await shot('todo-dragging');
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y - 4, button: 'left', clickCount: 1 });
  await waitFor(`document.querySelector('.todo-status').textContent === '已更新草稿'`);
  assert.deepEqual(await ids('.todo-list'), ['words', 'report', 'long', water.id, electricity.id]);
  assert.deepEqual((await saved()).map(item => item.id), ['words', 'milk', 'report', 'long', 'parcel', 'old', water.id, electricity.id]);
  assert.equal(await evaluate(`[...document.querySelectorAll('.todo-list li')].every(row => !row.style.transform)`), true);
  // The same move from the keyboard, keeping focus on the handle.
  await act(`const grip = document.querySelector('[data-id="words"] .todo-grip'); grip.focus(); grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
  assert.deepEqual((await ids('.todo-list')).slice(0, 2), ['report', 'words']);
  assert.equal(await evaluate(`document.activeElement === document.querySelector('[data-id="words"] .todo-grip')`), true);

  // Clearing tears off what is finished for good, except daily tasks; removing takes one task.
  await act(`document.querySelector('[data-id="words"] input').click()`);
  await waitFor(`document.querySelector('.todo-done [data-id="words"]')`);
  await act(`document.querySelector('.todo-clear').click()`);
  assert.deepEqual((await saved()).map(item => item.id), ['report', 'words', 'long', water.id, electricity.id]);
  assert.deepEqual(await ids('.todo-done'), ['words']);
  assert.equal(await evaluate(`document.querySelector('.todo-clear').hidden`), true);
  await act(`document.querySelector('[data-id="report"] .todo-remove').click()`);
  assert.equal((await saved()).some(item => item.id === 'report'), false);

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth && ${onGrid}`), true);
  await shot('todo-narrow');
  console.log('Todo: daily reset, due marks, ticking, adding with date or repeat, drag and keyboard reorder, clearing and the ruled grid verified');
});
