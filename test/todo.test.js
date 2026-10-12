import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../modules/todo/definition.js';
import { validDate, today, isDone, doneToday, settle, toggle, reorder, dueLabel } from '../modules/todo/items.js';

test('todo lists written before dates and repeats existed are kept as they are', () => {
  const old = { title: '接下来', items: [{ id: 'a', text: '写信', done: true }, { id: 'b', text: '买票', done: false }] };
  assert.deepEqual(validate(old), old);
});

test('todo validation keeps only meaningful dates and repeats', () => {
  const items = validate({ title: '', items: [
    { id: 'a', text: ' 交报告 ', done: false, due: '2026-10-15', daily: false, doneAt: '2026-10-01' },
    { id: 'b', text: '背单词', done: true, daily: true, due: '2026-10-15', doneAt: '2026-10-12' },
    { id: 'c', text: '空日期', done: false, due: '' },
  ] }).items;
  assert.deepEqual(items, [
    { id: 'a', text: '交报告', done: false, due: '2026-10-15' },
    { id: 'b', text: '背单词', done: true, daily: true, doneAt: '2026-10-12' },
    { id: 'c', text: '空日期', done: false },
  ]);
  for (const bad of [{ due: '2026-02-30' }, { due: '10/15' }, { due: 20261015 }, { doneAt: 'yesterday' }, { daily: 'yes' }])
    assert.throws(() => validate({ title: '', items: [{ id: 'a', text: 'x', done: false, ...bad }] }), JSON.stringify(bad));
});

test('dates are real calendar days in the reader\'s own time', () => {
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2026-13-01'), false);
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('a daily task ticked on an earlier day is open again', () => {
  const daily = { id: 'a', text: '背单词', done: true, daily: true, doneAt: '2026-10-11' }, once = { id: 'b', text: '写信', done: true, doneAt: '2026-10-11' };
  assert.equal(isDone(daily, '2026-10-11'), true);
  assert.equal(isDone(daily, '2026-10-12'), false);
  assert.equal(isDone(once, '2026-10-12'), true);
  assert.deepEqual(settle([daily, once], '2026-10-12'), [{ id: 'a', text: '背单词', done: false, daily: true }, once]);
  assert.deepEqual(settle([daily, once], '2026-10-11'), [daily, once]);
  assert.deepEqual(toggle({ id: 'a', text: 'x', done: false }, true, '2026-10-12'), { id: 'a', text: 'x', done: true, doneAt: '2026-10-12' });
  assert.deepEqual(toggle(once, false, '2026-10-12'), { id: 'b', text: '写信', done: false });
  assert.equal(doneToday([daily, once, { id: 'c', text: 'y', done: true }], '2026-10-11'), 2);
  assert.equal(doneToday([daily, once], '2026-10-12'), 0);
});

test('reordering moves the open tasks and leaves the finished ones in place', () => {
  const items = ['a', 'x', 'b', 'c', 'y'].map(id => ({ id }));
  assert.deepEqual(reorder(items, ['c', 'a', 'b']).map(item => item.id), ['c', 'x', 'a', 'b', 'y']);
});

test('due dates read as distance from today', () => {
  const day = '2026-10-12';
  assert.deepEqual(dueLabel('2026-10-09', day), { text: '逾期 3 天', state: 'late' });
  assert.deepEqual(dueLabel('2026-10-12', day), { text: '今天', state: 'today' });
  assert.deepEqual(dueLabel('2026-10-13', day), { text: '明天', state: 'soon' });
  assert.deepEqual(dueLabel('2026-10-15', day), { text: '周四', state: 'soon' });
  assert.deepEqual(dueLabel('2026-11-03', day), { text: '11月3日', state: 'later' });
  assert.deepEqual(dueLabel('2027-01-02', day), { text: '2027年1月2日', state: 'later' });
});
