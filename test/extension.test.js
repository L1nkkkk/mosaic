import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import '../extension/core.js';

const { RULE_ID, parsePrefix, matches, frameRules, relaxedCookie, knownDomain, responseCookie } = globalThis.MosaicCore;
const cookie = { name: 'SESSDATA', value: 'v', domain: '.example.com', path: '/', hostOnly: false, secure: false, httpOnly: true, session: false, expirationDate: 1900000000, sameSite: 'unspecified', storeId: '0' };

test('extension only recognises pages under the configured Mosaic address', () => {
  assert.deepEqual(parsePrefix(' https://example.com/mosaic/ '), { origin: 'https://example.com', path: '/mosaic' });
  assert.deepEqual(parsePrefix('http://localhost:3000'), { origin: 'http://localhost:3000', path: '' });
  for (const value of ['', undefined, 'example.com', 'javascript:alert(1)', 'chrome://extensions']) assert.equal(parsePrefix(value), null, String(value));
  const prefix = 'https://example.com/mosaic';
  for (const url of ['https://example.com/mosaic', 'https://example.com/mosaic/', 'https://example.com/mosaic/private?x=1#y']) assert.ok(matches(url, prefix), url);
  for (const url of ['https://example.com/', 'https://example.com/mosaic-other/', 'https://evil.test/mosaic/', 'http://example.com/mosaic/', 'https://example.com.evil.test/mosaic/', undefined, 'about:blank']) assert.ok(!matches(url, prefix), String(url));
  assert.ok(matches('http://localhost:3000/private', 'http://localhost:3000'));
  assert.ok(!matches('https://example.com/mosaic/', ''));
});

test('framing is unlocked for subframes of Mosaic tabs and nowhere else', () => {
  assert.deepEqual(frameRules([]), []);
  const [rule, ...rest] = frameRules([7, 9]);
  assert.equal(rest.length, 0);
  assert.equal(rule.id, RULE_ID);
  assert.deepEqual(rule.condition, { tabIds: [7, 9], resourceTypes: ['sub_frame'] });
  assert.deepEqual(rule.action.responseHeaders.map(header => [header.header, header.operation]), [['x-frame-options', 'remove'], ['content-security-policy', 'remove']]);
});

test('only cookies withheld from cross-site frames are rewritten, keeping their scope', () => {
  assert.deepEqual(relaxedCookie(cookie), { url: 'https://example.com/', name: 'SESSDATA', value: 'v', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', storeId: '0', domain: '.example.com', expirationDate: 1900000000 });
  assert.equal(relaxedCookie({ ...cookie, sameSite: 'lax' }).sameSite, 'no_restriction');
  assert.equal(relaxedCookie({ ...cookie, sameSite: 'strict' }), null);
  assert.equal(relaxedCookie({ ...cookie, sameSite: 'no_restriction' }), null);
  const hostOnly = relaxedCookie({ ...cookie, domain: 'www.example.com', hostOnly: true, session: true, path: '/a' });
  assert.equal(hostOnly.url, 'https://www.example.com/a');
  assert.ok(!('domain' in hostOnly) && !('expirationDate' in hostOnly));
});

test('later cookie writes are matched to sites opened in the module', () => {
  const known = ['www.example.com', '.example.com'];
  for (const domain of ['.example.com', 'api.example.com', 'www.example.com']) assert.ok(knownDomain(domain, known), domain);
  for (const domain of ['.example.org', 'notexample.com', 'com']) assert.ok(!knownDomain(domain, known), domain);
  assert.ok(!knownDomain('.example.com', []));
});

test('cookies a framed response sets are stored in a form the frame can read back', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.deepEqual(responseCookie('SESSDATA=a%2Cb=c; Path=/; Domain=example.com; Max-Age=60; Expires=Wed, 01 Jan 2020 00:00:00 GMT; HttpOnly; Secure', 'https://passport.example.com/x/login?y=1', now),
    { name: 'SESSDATA', value: 'a%2Cb=c', path: '/', secure: true, sameSite: 'no_restriction', domain: '.example.com', httpOnly: true, expirationDate: now / 1000 + 60, url: 'https://passport.example.com/' });
  const plain = responseCookie('sid=1; SameSite=Lax; Expires=Thu, 01 Jan 2026 00:01:00 GMT', 'https://www.example.com/a/b/c', now);
  assert.deepEqual([plain.path, plain.url, plain.expirationDate, 'domain' in plain], ['/a/b', 'https://www.example.com/a/b', now / 1000 + 60, false]);
  assert.equal(responseCookie('sid=1', 'https://www.example.com/', now).path, '/');
  for (const header of ['sid=1; SameSite=None; Secure', 'sid=1; SameSite=Strict', 'sid=1; Secure; Partitioned', '=1', 'novalue']) assert.equal(responseCookie(header, 'https://www.example.com/', now), null, header);
  assert.equal(responseCookie('sid=1', 'http://www.example.com/', now), null);
});

test('manifest references files that exist and requests no remote code', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  const files = [manifest.background.service_worker, manifest.options_ui.page, ...manifest.content_scripts.flatMap(script => script.js)];
  for (const file of files) await access(new URL(`../extension/${file}`, import.meta.url));
  assert.deepEqual(manifest.content_scripts.filter(script => script.world === 'MAIN').map(script => script.js), [['content-frame-main.js']]);
});
