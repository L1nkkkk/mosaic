import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderModules, resizeModule } from '../web/arrange.js';

test('drag ordering uses stable IDs and preserves modules hidden in a public preview', () => {
  const modules = [{ id: 'a' }, { id: 'private' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(reorderModules(modules, 'c', 'a').map(item => item.id), ['c', 'a', 'private', 'b']);
  assert.deepEqual(reorderModules(modules, 'a', 'b', true).map(item => item.id), ['private', 'b', 'a', 'c']);
  assert.deepEqual(reorderModules(modules, 'c', 'b').map(item => item.id), ['a', 'private', 'c', 'b']);
  assert.strictEqual(reorderModules(modules, 'a', 'private'), modules);
  assert.strictEqual(reorderModules(modules, 'a', 'a'), modules);
  assert.strictEqual(reorderModules(modules, 'missing', 'b'), modules);
  assert.deepEqual(modules.map(item => item.id), ['a', 'private', 'b', 'c']);
});

test('corner resizing snaps to the grid while retaining module minimum width', () => {
  const meta = { span: 6, minWidth: 280 };
  const box = { width: 589, height: 400 };
  assert.deepEqual(resizeModule(meta, undefined, box, { x: -180, y: 40 }, 1200, 22), { span: 4, height: 440 });
  assert.deepEqual(resizeModule(meta, undefined, box, { x: -580, y: -390 }, 1200, 22), { span: 3, height: 120 });
  assert.deepEqual(resizeModule(meta, undefined, box, { x: 2000, y: 3000 }, 1200, 22), { span: 12, height: 1600 });
  assert.deepEqual(resizeModule(meta, { span: 4 }, { width: 350, height: 400 }, { x: -250, y: 30 }, 350, 16), { span: 12, height: 432 });
});

test('single-axis resizing preserves automatic height and desktop width on a narrow screen', () => {
  const meta = { span: 6, minWidth: 280, aspectRatio: 16 / 9 };
  assert.deepEqual(resizeModule(meta, undefined, { width: 589, height: 400 }, { x: 400, y: 2 }, 1200, 22), { span: 10 });
  assert.deepEqual(resizeModule(meta, { span: 4 }, { width: 350, height: 400 }, { x: 2, y: 80 }, 350, 16), { span: 4, height: 480 });
  assert.deepEqual(resizeModule(meta, { height: 256 }, { width: 589, height: 256 }, { x: 200, y: 1 }, 1200, 22), { span: 8, height: 256 });
  assert.equal(resizeModule(meta, undefined, { width: 350, height: 400 }, { x: 2, y: 3 }, 350, 16), undefined);
});
