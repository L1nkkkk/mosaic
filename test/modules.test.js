import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, initialPage, validatePage } from '../server/modules.js';
import { fileURLToPath } from 'node:url';

test('every module validates defaults and escapes user-controlled markup', async () => {
  const registry = await loadModules(fileURLToPath(new URL('../modules', import.meta.url)));
  assert.equal(validatePage(initialPage(registry), registry).modules.length, registry.size);
  for (const module of registry.values()) {
    const data = structuredClone(module.meta.defaultData);
    data.title = '<img src=x onerror="alert(1)">';
    const html = module.render(module.validate(data));
    assert.ok(!html.includes('<img src=x'), module.meta.id);
    assert.ok(html.includes('&lt;img'), module.meta.id);
  }
});
