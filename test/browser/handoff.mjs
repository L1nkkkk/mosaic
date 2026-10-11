import assert from 'node:assert/strict';
import { withBrowser } from './harness.mjs';
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  const state = await app.store.read();
  const book = (id, url) => ({ id, title: '书 ' + id, author: '', note: '', cover: '', url, status: 'done' });
  const shelf = { id: 'shelf', type: 'books', audience: 'public', visible: true, data: { title: '书架', decor: true, items: [book('web', 'https://example.com/book'), book('plain', 'http://example.com/book'), book('none', '')] } };
  const browser = { id: 'browser', type: 'browser', audience: 'private', visible: false, data: structuredClone(app.registry.get('browser').meta.defaultData) };
  const offered = () => evaluate(`!document.querySelector('.book-open-here').hidden`);
  const pull = index => evaluate(`document.querySelectorAll('.books-shelf .book')[${index}].click()`);

  await app.store.mutate(state.revision, s => ({ ...s, draft: { title: '联动', modules: [shelf, browser] }, published: { title: '联动', modules: [shelf, browser] } }));
  // Visitors have no browser module, so they only get the plain link.
  await command('Page.navigate', { url: base + '/' });
  await waitFor('document.querySelectorAll(".books-shelf .book").length===3');
  await pull(0);
  assert.deepEqual([await offered(), await evaluate(`document.querySelector('.book-detail a').href`)], [false, 'https://example.com/book']);

  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".books-shelf .book").length===3 && document.querySelector(".browser-module input")');
  await pull(0);
  assert.equal(await offered(), true);
  await evaluate(`document.querySelector('.book-open-here').click()`);
  assert.equal(await evaluate(`document.querySelector('.browser-module input').value`), 'https://example.com/book');
  // Only HTTPS addresses can be handed over, and a book without a link offers nothing.
  await pull(1); assert.equal(await offered(), false);
  await pull(2); assert.equal(await offered(), false);

  // Without a browser module on the page the offer disappears.
  const next = await app.store.read();
  await app.store.mutate(next.revision, s => ({ ...s, draft: { title: '联动', modules: [shelf] } }));
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".books-shelf .book").length===3');
  await pull(0);
  assert.equal(await offered(), false);
  console.log('Handoff: a book link opens in the browser module on the same private page, and is not offered to visitors, for non-HTTPS links or without a browser module');
});
