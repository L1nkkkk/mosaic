import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadModules, validatePage } from '../server/modules.js';
import { meta, validate } from '../modules/browser/definition.js';
import { resolveAddress } from '../modules/browser/address.js';

test('browser module accepts only HTTPS destinations and a bounded bookmark list', () => {
  assert.deepEqual(validate(structuredClone(meta.defaultData)), meta.defaultData);
  assert.equal(validate({ title: 'x' }).home, meta.defaultData.home);
  for (const home of ['http://example.com/', 'javascript:alert(1)', 'example.com', '']) assert.throws(() => validate({ ...meta.defaultData, home }), /https:\/\//, home);
  assert.throws(() => validate({ ...meta.defaultData, search: 'https://www.bing.com/search' }), /%s/);
  assert.throws(() => validate({ ...meta.defaultData, bookmarks: [{ label: 'x', url: 'http://example.com/' }] }), /https:\/\//);
  assert.throws(() => validate({ ...meta.defaultData, bookmarks: Array.from({ length: 13 }, () => ({ label: 'x', url: 'https://example.com/' })) }), /12/);
  assert.throws(() => validate({ ...meta.defaultData, bookmarks: [null] }));
});

test('browser module can never be published', async () => {
  const registry = await loadModules(fileURLToPath(new URL('../modules', import.meta.url)));
  const page = audience => ({ title: 't', modules: [{ id: 'b', type: 'browser', audience, visible: true, data: structuredClone(meta.defaultData) }] });
  assert.equal(validatePage(page('private'), registry).modules[0].audience, 'private');
  assert.throws(() => validatePage(page('public'), registry), /只能在私人页显示/);
});

test('address bar input becomes an HTTPS address or a search', () => {
  const search = meta.defaultData.search;
  assert.equal(resolveAddress('  www.bilibili.com/video/BV1?p=2 ', search), 'https://www.bilibili.com/video/BV1?p=2');
  assert.equal(resolveAddress('http://example.com/a', search), 'https://example.com/a');
  assert.equal(resolveAddress('HTTPS://Example.com', search), 'https://example.com/');
  assert.equal(resolveAddress('hello world', search), 'https://www.bing.com/search?q=hello%20world');
  assert.equal(resolveAddress('localhost', search), 'https://www.bing.com/search?q=localhost');
  assert.equal(resolveAddress('a&b=c', search), 'https://www.bing.com/search?q=a%26b%3Dc');
  assert.equal(resolveAddress('   ', search), '');
});
