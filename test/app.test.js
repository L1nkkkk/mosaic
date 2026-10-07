import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { passwordHash } from '../server/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const password = 'test-only-editor-password';
const hash = await passwordHash(password);
const origin = 'https://mosaic.test';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-test-'));
  const config = { root, dataDirectory: directory, basePath: '/mosaic', publicOrigin: origin, passwordHash: hash, sessionSecret: 'test-session-secret-at-least-32-characters', version: 'test', commit: 'test-commit' };
  let app;
  let address;
  async function start() {
    app = await createApp(config);
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    address = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() { if (app?.server.listening) { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); } }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
    const response = await fetch(`${address}${route}`, { method, headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const content = await response.text();
    return { status: response.status, headers: response.headers, text: content, value: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content) : null };
  }
  async function login() {
    const result = await request('/mosaic/api/login', { method: 'POST', body: { password } });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  }
  return { request, login, directory, config, restart: async () => { await stop(); await start(); }, stop };
}

test('private editor requires authentication and rejects forged cookies and cross-site writes', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/mosaic/api/admin/state')).status, 401);
  assert.equal((await f.request('/mosaic/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const cookie = await f.login();
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie })).status, 200);
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie: cookie + 'tampered' })).status, 401);
  assert.equal((await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, requestOrigin: 'https://elsewhere.test', body: { revision: 1 } })).status, 403);
  const login = await f.request('/mosaic/api/login', { method: 'POST', body: { password } });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
  assert.match((await f.request('/mosaic/api/logout', { method: 'POST', cookie, body: {} })).headers.get('set-cookie'), /Max-Age=0/);
});

test('draft is private until publishing; both survive application replacement', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const initial = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const page = structuredClone(initial.draft);
  page.title = 'Saved private draft';
  const saved = await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: initial.revision, page } });
  assert.equal(saved.status, 200);
  assert.equal((await f.request('/mosaic/api/page')).value.page.title, initial.published.title);
  await f.restart();
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie })).value.draft.title, page.title);
  assert.equal((await f.request('/mosaic/api/page')).value.page.title, initial.published.title);
  const published = await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: saved.value.revision } });
  assert.equal(published.status, 200);
  await f.restart();
  assert.equal((await f.request('/mosaic/api/page')).value.page.title, page.title);
});

test('simultaneous writers cannot silently overwrite one another', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const replies = await Promise.all(['First', 'Second'].map(title => f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: { ...state.draft, title } } })));
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  const winner = replies.find(reply => reply.status === 200).value;
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie })).value.draft.title, winner.draft.title);
});

test('hidden modules and draft content are absent from public responses', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  state.draft.modules[0].visible = false;
  state.draft.modules[0].data.title = 'hidden-content-marker';
  const saved = await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } });
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: saved.value.revision } });
  const page = await f.request('/mosaic/api/page');
  assert.ok(!page.text.includes('hidden-content-marker'));
  assert.equal(page.value.page.modules.length, state.draft.modules.length - 1);
});

test('bad module data and dangerous link protocols are rejected without changing saved content', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  for (const mutation of [
    page => { page.modules[0].type = 'missing-module'; },
    page => { page.modules.push(page.modules[0]); },
    page => { page.modules.find(item => item.type === 'links').data.items[0].url = 'javascript:alert(1)'; },
    page => { page.title = ''; },
  ]) {
    const page = structuredClone(state.draft); mutation(page);
    assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page } })).status, 400);
  }
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie })).value.revision, state.revision);
  assert.equal((await f.request('/mosaic/api/login', { method: 'POST', body: null })).status, 400);
});

test('base path, public assets, health and content security headers work without exposing files', async t => {
  const f = await fixture(t);
  const home = await f.request('/mosaic/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<base href="\/mosaic\/">/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await f.request('/mosaic/web/app.js')).status, 200);
  assert.equal((await f.request('/mosaic/modules/intro/index.js')).status, 200);
  assert.equal((await f.request('/mosaic/api/health')).value.commit, 'test-commit');
  for (const route of ['/api/page', '/mosaic/.env', '/mosaic/data/content.json', '/mosaic/server/auth.js', '/mosaic/web/%2e%2e%2fserver/app.js', '/mosaic/modules/%2e%2e%2f.env']) assert.equal((await f.request(route)).status, 404, route);
});

test('repeated wrong passwords are rate limited', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/mosaic/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await f.request('/mosaic/api/login', { method: 'POST', body: { password } })).status, 429);
});

test('unreadable existing content fails startup instead of resetting the site', async t => {
  const f = await fixture(t);
  await f.stop();
  const filename = path.join(f.directory, 'content.json');
  await writeFile(filename, 'not-valid-json');
  await assert.rejects(createApp(f.config));
  assert.equal(await readFile(filename, 'utf8'), 'not-valid-json');
});
