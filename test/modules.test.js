import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, initialPage, validatePage } from '../server/modules.js';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('every module validates defaults and escapes user-controlled markup', async () => {
  const registry = await loadModules(fileURLToPath(new URL('../modules', import.meta.url)));
  assert.equal(validatePage(initialPage(registry), registry).modules.length, registry.size);
  for (const module of registry.values()) {
    if (!module.render) continue; // Browser lifecycle modules are covered by browser tests.
    const data = structuredClone(module.meta.defaultData);
    data.title = '<img src=x onerror="alert(1)">';
    const html = module.render(module.validate(data));
    assert.ok(!html.includes('<img src=x'), module.meta.id);
    assert.ok(html.includes('&lt;img'), module.meta.id);
  }
});

test('module discovery rejects invalid sizing declarations before deployment', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-module-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await mkdir(path.join(directory, 'broken-layout'));
  await writeFile(path.join(directory, 'broken-layout', 'index.js'), `export const meta = { id: 'broken-layout', layout: { span: 24 }, defaultData: {} }; export function validate(data) { return data; } export function render() { return ''; } export function edit() {}`);
  await assert.rejects(loadModules(directory), /占列数/);
});

test('split module discovery never executes browser code in Node', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-split-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await mkdir(path.join(directory, 'browser-only'));
  await writeFile(path.join(directory, 'browser-only/definition.js'), `export const meta = { id: 'browser-only', defaultData: {} }; export function validate(data) { return data; }`);
  await writeFile(path.join(directory, 'browser-only/client.js'), `document.createElement('canvas'); throw new Error('Must not execute in Node');`);
  const registry = await loadModules(directory);
  assert.equal(registry.get('browser-only').entry, 'client.js');
});

test('a module can reduce what Public receives without changing the saved content', async () => {
  const { publicPage } = await import('../server/modules.js');
  const registry = new Map([['board', { meta: { id: 'board', name: 'Board', layout: { span: 6, minWidth: 0 } }, validate: data => data, publicData: data => ({ stage: data.stage }) }]]);
  const page = { title: 'Space', modules: [{ id: 'one', type: 'board', audience: 'public', visible: true, data: { stage: 'alpha', notes: 'INTERNAL' } }] };
  assert.deepEqual(publicPage(page, registry).modules[0].data, { stage: 'alpha' });
  assert.equal(page.modules[0].data.notes, 'INTERNAL');
});

test('project progress keeps notes and private milestones away from visitors', async () => {
  const { validate, publicData, meta } = await import('../modules/projects/definition.js');
  const project = { ...meta.defaultData.projects[0], note: 'INTERNAL', milestones: [{ text: 'open', done: true }, { text: 'SECRET', done: false, private: true }, { text: 'next', done: false, private: false }] };
  const data = validate({ title: ' Work ', projects: [project] });
  assert.equal(data.title, 'Work');
  assert.deepEqual(data.projects[0].milestones, [{ text: 'open', done: true }, { text: 'SECRET', done: false, private: true }, { text: 'next', done: false }]);
  const shown = publicData(data);
  assert.ok(!JSON.stringify(shown).includes('INTERNAL') && !JSON.stringify(shown).includes('SECRET'));
  assert.deepEqual(shown.projects[0].progress, { done: 1, total: 3 });
  assert.deepEqual(shown.projects[0].milestones, [{ text: 'open', done: true }, { text: 'next', done: false }]);
  for (const mutate of [p => { p.stage = 'launched'; }, p => { p.accent = 'url(evil)'; }, p => { p.url = 'javascript:alert(1)'; }, p => { p.name = ' '; }, p => { p.milestones = Array(25).fill({ text: 'm', done: false }); }, p => { p.milestones = [{ text: 'm', done: 'yes' }]; }]) {
    const bad = structuredClone(project); mutate(bad);
    assert.throws(() => validate({ title: '', projects: [bad] }));
  }
  assert.throws(() => validate({ title: '', projects: [project, project] }));
});
