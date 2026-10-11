import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadModules, validatePage, publicPage } from '../server/modules.js';
import { pagesOf, placedModules } from '../web/spaces.js';

const registry = await loadModules(fileURLToPath(new URL('../modules', import.meta.url)));
const note = registry.get('note').meta.defaultData;
const modules = ['a', 'b', 'c'].map(id => ({ id, type: 'note', data: structuredClone(note) }));
const draft = (pages, items) => ({ title: '页面', modules, pages, spaces: { public: { items: [{ id: 'a' }] }, private: { flow: 'grid', items } } });

test('private pages partition the private space and stay out of the public page', () => {
  const page = validatePage(draft([{ id: 'main', title: ' 总览 ', flow: 'masonry' }, { id: 'money', title: '理财' }], [{ id: 'a', page: 'main' }, { id: 'b', page: 'money', layout: { span: 6 } }, { id: 'c' }]), registry);
  assert.deepEqual(page.pages, [{ id: 'main', title: '总览', flow: 'masonry' }, { id: 'money', title: '理财' }]);
  // Only pages other than the first are written on a placement; the first page's flow is the space's.
  assert.deepEqual(page.spaces.private, { flow: 'masonry', items: [{ id: 'a' }, { id: 'b', layout: { span: 6 }, page: 'money' }, { id: 'c' }] });
  assert.deepEqual(placedModules(page, 'private', 'main').map(item => item.id), ['a', 'c']);
  assert.deepEqual(placedModules(page, 'private', 'money').map(item => item.id), ['b']);
  assert.deepEqual(placedModules(page, 'private').map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(validatePage(page, registry), page, 'a saved page validates to itself');
  const visitor = publicPage(page, registry);
  assert.deepEqual([Object.keys(visitor), visitor.modules.map(item => item.id)], [['title', 'modules'], ['a']]);
  assert.ok(!JSON.stringify(visitor).includes('理财'));
});

test('a single page is not stored and readers without pages still see every private module', () => {
  const single = validatePage(draft([{ id: 'main', title: '总览', flow: 'masonry' }], [{ id: 'a', page: 'main' }, { id: 'b' }, { id: 'c' }]), registry);
  assert.equal(single.pages, undefined);
  assert.equal(single.spaces.private.flow, 'masonry');
  assert.ok(single.spaces.private.items.every(entry => entry.page === undefined));
  assert.deepEqual(pagesOf(single), [{ id: 'main', title: '总览', flow: 'masonry' }]);
  // What a previous version does on rollback: it keeps only the fields it knows.
  const paged = validatePage(draft([{ id: 'main', title: '总览' }, { id: 'money', title: '理财' }], [{ id: 'a' }, { id: 'b', page: 'money' }, { id: 'c' }]), registry);
  const older = { title: paged.title, modules: paged.modules, spaces: { public: paged.spaces.public, private: { items: paged.spaces.private.items.map(({ page, ...entry }) => entry) } } };
  assert.deepEqual(placedModules(validatePage(older, registry), 'private').map(item => item.id), ['a', 'b', 'c']);
});

test('invalid pages are rejected', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }], main = { id: 'main', title: '总览' };
  for (const pages of [[main, { id: 'main', title: '重复' }], [main, { id: 'Bad Id', title: '理财' }], [main, { id: 'money', title: '' }], [main, { id: 'money', title: '理财', flow: 'rows' }], Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, title: '页' })), 'money'])
    assert.throws(() => validatePage(draft(pages, items), registry));
  assert.throws(() => validatePage(draft([main, { id: 'money', title: '理财' }], [{ id: 'a', page: 'gone' }, { id: 'b' }, { id: 'c' }]), registry), /页面不存在/);
});
