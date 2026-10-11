import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  const note = app.registry.get('note').meta.defaultData, todo = app.registry.get('todo').meta.defaultData;
  const page = { title: 'Mosaic · 两个空间', modules: [
    ...['a', 'b', 'c'].map(id => ({ id: 'note-' + id, type: 'note', audience: 'public', visible: true, layout: { span: 4, height: 200 }, data: { ...note, title: '手记 ' + id } })),
    { id: 'tasks', type: 'todo', audience: 'public', visible: true, layout: { span: 6 }, data: structuredClone(todo) },
    { id: 'desk', type: 'note', audience: 'private', visible: false, data: { ...note, title: '工作台手记' } },
  ] };
  await app.store.mutate(state.revision, s => ({ ...s, draft: page, published: page }));
  const order = scope => evaluate(`[...document.querySelectorAll('${scope}>.module-slot')].map(slot => slot.dataset.moduleId)`);
  const setting = (label, value) => evaluate(`(() => { document.querySelector('.module-settings').open = true; const field = document.querySelector('[aria-label="${label}"]'); if (field.type === 'checkbox') field.click(); else { field.value = '${value}'; field.dispatchEvent(new Event('change')); } })()`);
  const edit = async id => { await evaluate(`document.querySelector('[data-module-id="${id}"] .module-edit-button').click()`); await waitFor('document.querySelector("#module-editor").open'); };
  const done = async () => { await evaluate(`document.querySelector('[data-close="module-editor"]').click()`); await waitFor('!document.querySelector("#module-editor").open'); };

  await command('Page.navigate', { url: base + '/edit' });
  await waitFor('document.querySelectorAll("#preview-page>.module-slot").length===5');
  // Arranging Public leaves Private untouched.
  await evaluate(`document.querySelector('#public-preview').click()`);
  await waitFor('document.querySelectorAll("#preview-page>.module-slot").length===4');
  await evaluate(`(() => { const handle = document.querySelector('[data-module-id="tasks"] [data-layout-action="move"]'); handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); })()`);
  assert.deepEqual(await order('#preview-page'), ['tasks', 'note-a', 'note-b', 'note-c']);
  await edit('note-a'); await setting('模块宽度', '12'); await done();
  // A module can live only in Public, and a shared one can publish its content live.
  await edit('note-c'); await setting('显示范围', 'public-only'); await done();
  await edit('tasks'); await setting('实时同步'); await done();
  await evaluate(`document.querySelector('#private-preview').click()`);
  assert.deepEqual(await order('#preview-page'), ['note-a', 'note-b', 'tasks', 'desk']);
  assert.equal(await evaluate(`document.querySelector('[data-module-id="note-a"]').dataset.span`), '4');
  assert.equal(await evaluate(`document.querySelector('[data-module-id="desk"] .audience-badge').textContent`), '仅私人空间');
  // Private-only modules cannot be offered to Public from the editor.
  await edit('desk');
  assert.deepEqual(await evaluate(`[...document.querySelector('[aria-label="显示范围"]').options].map(option => option.value)`), ['private', 'public', 'public-only']);
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="实时同步"]'))`), false);
  await done();
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/spaces-editor.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  await evaluate(`document.querySelector('#publish').click()`);
  await waitFor(`document.querySelector('#save-status').textContent === '公开页已更新'`);
  const saved = await app.store.read();
  assert.deepEqual(saved.published.spaces.public.items.map(entry => entry.id), ['tasks', 'note-a', 'note-b', 'note-c']);
  assert.deepEqual(saved.published.spaces.private.items.map(entry => entry.id), ['note-a', 'note-b', 'tasks', 'desk']);
  // The editor reloads into the same two arrangements.
  await command('Page.navigate', { url: base + '/edit' });
  await waitFor('document.querySelectorAll("#preview-page>.module-slot").length===4');
  assert.deepEqual(await order('#preview-page'), ['note-a', 'note-b', 'tasks', 'desk']);

  await command('Page.navigate', { url: base + '/' });
  await waitFor('document.querySelectorAll("#public-page>.module-slot").length===4');
  assert.deepEqual(await order('#public-page'), ['tasks', 'note-a', 'note-b', 'note-c']);
  assert.equal(await evaluate(`document.querySelector('[data-module-id="note-a"]').dataset.span`), '12');

  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll("#private-page>.module-slot").length===4');
  assert.deepEqual(await order('#private-page'), ['note-a', 'note-b', 'tasks', 'desk']);
  // Ticking a task in the workspace reaches visitors without publishing.
  await evaluate(`document.querySelector('.todo-module input[type=checkbox]').click()`);
  await waitFor(`fetch('api/page').then(r => r.json()).then(v => v.page.modules.find(m => m.id === 'tasks').data.items[0].done === true)`);
  console.log('Spaces: separate Public and Private arrangements, public-only and shared modules, per-space sizes, reload, and live content verified');
});
