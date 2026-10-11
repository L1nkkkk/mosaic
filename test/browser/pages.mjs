import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  const note = app.registry.get('note').meta.defaultData;
  const page = { title: 'Mosaic · 分页', modules: [
    ...['a', 'b', 'c'].map(id => ({ id: 'note-' + id, type: 'note', audience: 'public', visible: true, layout: { span: 4, height: 200 }, data: { ...note, title: '手记 ' + id } })),
    { id: 'desk', type: 'note', audience: 'private', visible: false, data: { ...note, title: '工作台手记' } },
  ] };
  await app.store.mutate(state.revision, s => ({ ...s, draft: page, published: page }));
  const order = scope => evaluate(`[...document.querySelectorAll('${scope}>.module-slot')].map(slot => slot.dataset.moduleId)`);
  const count = (scope, n) => waitFor(`document.querySelectorAll('${scope}>.module-slot').length===${n}`);
  const setting = (label, value) => evaluate(`(() => { document.querySelector('.module-settings').open = true; const field = document.querySelector('[aria-label="${label}"]'); field.value = '${value}'; field.dispatchEvent(new Event('change')); })()`);
  const type = (selector, value) => evaluate(`(() => { const input = document.querySelector('${selector}'); input.value = '${value}'; input.dispatchEvent(new Event('input')); })()`);

  await command('Page.navigate', { url: base + '/edit' });
  await count('#preview-page', 4);
  // One page: no tabs, only the way to add one.
  assert.equal(await evaluate(`document.querySelectorAll('#page-preview .segmented button').length`), 0);
  await evaluate(`document.querySelector('#add-page').click()`);
  await waitFor('document.querySelector("#page-settings").open');
  await count('#preview-page', 0);
  await type('#page-list .page-editor:nth-of-type(2) input', '理财');
  await type('#page-list .page-editor:nth-of-type(2) label:nth-of-type(2) input', 'Bad Address');
  assert.equal(await evaluate(`document.querySelector('#page-list [aria-invalid]').getAttribute('aria-invalid')`), 'true');
  await type('#page-list .page-editor:nth-of-type(2) label:nth-of-type(2) input', 'money');
  await evaluate(`document.querySelector('#page-settings [data-close]').click()`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#page-preview .segmented button')].map(button => button.textContent + (button.classList.contains('active') ? '*' : ''))`), ['总览', '理财*']);

  // Moving a module to another page takes it off this one.
  await evaluate(`document.querySelector('#page-preview [data-page="main"]').click()`);
  await count('#preview-page', 4);
  await evaluate(`document.querySelector('[data-module-id="desk"] .module-edit-button').click()`);
  await waitFor('document.querySelector("#module-editor").open');
  await setting('所在页面', 'money');
  await evaluate(`document.querySelector('[data-close="module-editor"]').click()`);
  assert.deepEqual(await order('#preview-page'), ['note-a', 'note-b', 'note-c']);

  // Copy on one page, paste on another: a second instance with the same content and size.
  assert.equal(await evaluate(`document.querySelector('#paste-module').disabled`), true);
  await evaluate(`document.querySelector('[data-module-id="note-a"] .module-copy-button').click()`);
  assert.equal(await evaluate(`document.querySelector('#paste-module').textContent`), '粘贴「手记 a」');
  await evaluate(`document.querySelector('#page-preview [data-page="money"]').click()`);
  await count('#preview-page', 1);
  await evaluate(`document.querySelector('#paste-module').click()`);
  await count('#preview-page', 2);
  const pasted = (await order('#preview-page'))[1];
  assert.ok(pasted !== 'note-a' && pasted.length > 10);
  assert.equal(await evaluate(`document.querySelector('[data-module-id="${pasted}"]').dataset.span`), '4');
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/pages-editor.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));

  await evaluate(`document.querySelector('#save-draft').click()`);
  await waitFor(`document.querySelector('#save-status').textContent === '草稿已保存'`);
  const saved = (await app.store.read()).draft;
  assert.deepEqual(saved.pages, [{ id: 'main', title: '总览' }, { id: 'money', title: '理财' }]);
  assert.deepEqual(saved.spaces.private.items.map(entry => [entry.id, entry.page]), [['note-a', undefined], ['note-b', undefined], ['note-c', undefined], ['desk', 'money'], [pasted, 'money']]);
  assert.deepEqual(saved.modules.find(item => item.id === pasted).data, saved.modules.find(item => item.id === 'note-a').data);
  // The copy is private until someone shares it; the public page is untouched.
  assert.deepEqual(saved.spaces.public.items.map(entry => entry.id), ['note-a', 'note-b', 'note-c']);

  // The workspace shows one page at a time, each at its own address.
  await command('Page.navigate', { url: base + '/private' });
  await count('#private-page', 3);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#page-tabs a')].map(link => link.textContent + (link.hasAttribute('aria-current') ? '*' : ''))`), ['总览*', '理财']);
  await evaluate(`document.querySelector('#page-tabs a[data-page="money"]').click()`);
  await count('#private-page', 2);
  assert.deepEqual([await evaluate('location.pathname'), await order('#private-page')], ['/private/money', ['desk', pasted]]);
  await evaluate('history.back()');
  await count('#private-page', 3);
  assert.equal(await evaluate('location.pathname'), '/private');
  await command('Page.navigate', { url: base + '/private/money' });
  await count('#private-page', 2);
  assert.equal(await evaluate('document.title'), '理财 · 私人空间 · Mosaic');
  if (process.env.MOSAIC_REVIEW_DIR) await writeFile(process.env.MOSAIC_REVIEW_DIR + '/pages-private.png', Buffer.from((await command('Page.captureScreenshot')).data, 'base64'));
  // An address that names no page shows the first one.
  await command('Page.navigate', { url: base + '/private/gone' });
  await count('#private-page', 3);
  assert.equal(await evaluate('location.pathname'), '/private');

  // Deleting a page sends its modules home, and one page left means no tabs are stored.
  await command('Page.navigate', { url: base + '/edit' });
  await count('#preview-page', 3);
  await evaluate(`document.querySelector('#open-page-settings').click()`);
  await evaluate(`document.querySelector('#page-list .page-editor:nth-of-type(2) .danger').click()`);
  await evaluate(`document.querySelector('#page-settings [data-close]').click()`);
  await count('#preview-page', 5);
  await evaluate(`document.querySelector('#save-draft').click()`);
  await waitFor(`document.querySelector('#save-status').textContent === '草稿已保存'`);
  const merged = (await app.store.read()).draft;
  assert.equal(merged.pages, undefined);
  assert.equal(merged.modules.length, 5);
  console.log('Pages: adding, renaming and deleting private pages, moving modules between them, copy and paste, per-page addresses and history verified');
});
