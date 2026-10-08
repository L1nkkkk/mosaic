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
