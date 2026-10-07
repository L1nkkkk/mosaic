import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, normalizeLayoutOverride, resolveLayoutSpan } from '../web/layout.js';

test('layout accepts old modules and a small declarative sizing contract', () => {
  assert.deepEqual(normalizeLayout('wide'), { span: 12, minWidth: 280 });
  assert.deepEqual(normalizeLayout('half'), { span: 6, minWidth: 280 });
  assert.deepEqual(normalizeLayout(), { span: 6, minWidth: 280 });
  assert.deepEqual(normalizeLayout({ span: 4, minWidth: 240, aspectRatio: 16 / 9 }), { span: 4, minWidth: 240, aspectRatio: 16 / 9 });
  for (const value of [null, [], 'full', { span: 0 }, { span: 13 }, { span: 3.5 }, { span: '6' }, { minWidth: -1 }, { minWidth: Infinity }, { minWidth: '280px' }, { aspectRatio: 0 }, { aspectRatio: NaN }, { aspectRatio: 11 }, { height: 200 }]) assert.throws(() => normalizeLayout(value));
});

test('cards promote from four to three to two to one per row as available space shrinks', () => {
  const layout = { span: 3, minWidth: 280 };
  assert.equal(resolveLayoutSpan(layout, 1200, 22), 3);
  assert.equal(resolveLayoutSpan(layout, 900, 22), 4);
  assert.equal(resolveLayoutSpan(layout, 650, 22), 6);
  assert.equal(resolveLayoutSpan(layout, 390, 22), 12);
  assert.equal(resolveLayoutSpan(layout, 240, 22), 12);
  assert.equal(resolveLayoutSpan(layout, 0, 22), 12);
  // A large screen does not justify narrow cards in a small editor container.
  assert.equal(resolveLayoutSpan({ span: 6, minWidth: 300 }, 550, 14), 12);
  assert.equal(resolveLayoutSpan({ span: 6, minWidth: 300 }, 614, 14), 6);
  assert.equal(resolveLayoutSpan({ span: 6, minWidth: 300 }, 613, 14), 12);
  assert.equal(resolveLayoutSpan({ span: 8, minWidth: 280 }, 1000, 22), 8);
  assert.equal(resolveLayoutSpan({ span: 12, minWidth: 280 }, 1600, 22), 12);
});

test('responsive widths stay within the grid and respect minimum widths when space permits', () => {
  for (const requested of [1, 3, 4, 5, 6, 8, 12]) {
    let previous = 12;
    for (let width = 100; width <= 1800; width += 13) {
      const span = resolveLayoutSpan({ span: requested, minWidth: 280 }, width, 22);
      const actual = (width + 22) * span / 12 - 22;
      assert.ok(Number.isInteger(span) && span >= requested && span <= 12);
      assert.ok(span <= previous, 'A larger container must not require a larger fraction.');
      assert.ok(actual <= width + 0.001);
      assert.ok(actual >= Math.min(280, width) - 0.001);
      previous = span;
    }
  }
});

test('instance frame overrides validate height and cannot change minimum width or inject style text', () => {
  assert.equal(normalizeLayoutOverride(undefined), undefined);
  assert.equal(normalizeLayoutOverride({}), undefined);
  assert.deepEqual(normalizeLayoutOverride({ span: 4 }), { span: 4 });
  assert.deepEqual(normalizeLayoutOverride({ height: 320 }), { height: 320 });
  assert.deepEqual(normalizeLayoutOverride({ span: 4, height: 320 }), { span: 4, height: 320 });
  for (const value of [null, [], 'half', { span: 0 }, { span: 13 }, { span: 1.5 }, { span: '6; color:red' }, { minWidth: 0 }, { span: 4, aspectRatio: 1 }, { height: 0 }, { height: 1601 }, { height: 200.5 }, { height: '300px' }, { height: null }]) assert.throws(() => normalizeLayoutOverride(value));
  const requested = { ...normalizeLayout({ span: 6, minWidth: 300 }), ...normalizeLayoutOverride({ span: 3 }) };
  assert.equal(resolveLayoutSpan(requested, 900, 22), 6);
});
