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
  const config = { root, dataDirectory: directory, statusFile: path.join(directory, 'status.json'), proxyStatusFile: path.join(directory, 'proxies.json'), basePath: '/mosaic', publicOrigin: origin, passwordHash: hash, sessionSecret: 'test-session-secret-at-least-32-characters', version: 'test', commit: 'test-commit' };
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
  const publicCount = (await f.request('/mosaic/api/page')).value.page.modules.length;
  const intro = state.draft.modules.find(item => item.type === 'intro');
  intro.visible = false;
  intro.data.title = 'hidden-content-marker';
  const saved = await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } });
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: saved.value.revision } });
  const page = await f.request('/mosaic/api/page');
  assert.ok(!page.text.includes('hidden-content-marker'));
  assert.equal(page.value.page.modules.length, publicCount - 1);
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

test('deployment preflight rejects content referencing unavailable modules', async t => {
  const f = await fixture(t);
  await f.stop();
  const filename = path.join(f.directory, 'content.json');
  const state = JSON.parse(await readFile(filename, 'utf8'));
  state.draft.modules[0].type = 'module-removed-in-new-release';
  const original = JSON.stringify(state);
  await writeFile(filename, original);
  await assert.rejects(createApp(f.config), /不支持的模块/);
  assert.equal(await readFile(filename, 'utf8'), original);
});

test('private modules never enter public responses, even for a signed-in visitor', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const note = state.draft.modules.find(item => item.type === 'note');
  note.audience = 'private'; note.visible = true; note.data.body = 'PRIVATE-MODULE-CONTENT-MARKER';
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.equal(state.draft.modules.find(item => item.id === note.id).visible, false);
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: state.revision } });
  for (const visitor of [undefined, cookie]) {
    const publicResponse = await f.request('/mosaic/api/page?audience=private', { cookie: visitor });
    assert.equal(publicResponse.status, 200);
    assert.ok(!publicResponse.text.includes('PRIVATE-MODULE-CONTENT-MARKER'));
    assert.ok(!publicResponse.value.page.modules.some(item => item.type.endsWith('-status')));
    assert.ok((await f.request('/mosaic/api/modules', { cookie: visitor })).value.modules.every(module => !module.privateOnly));
  }
  const owner = await f.request('/mosaic/api/private/page', { cookie });
  assert.equal(owner.value.page.modules.length, state.draft.modules.length);
  assert.ok(owner.text.includes('PRIVATE-MODULE-CONTENT-MARKER'));
});

test('saving Private immediately revokes published access; restoring Public requires publishing', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const id = state.draft.modules.find(item => item.type === 'intro').id;
  state.draft.modules.find(item => item.id === id).audience = 'private';
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.equal((await f.request('/mosaic/api/page')).value.page.modules.some(item => item.id === id), false);
  // Even an old reader that only understands visible cannot expose the content.
  assert.equal(state.published.modules.find(item => item.id === id).visible, false);
  await f.restart();
  assert.equal((await f.request('/mosaic/api/page')).value.page.modules.some(item => item.id === id), false);
  const item = state.draft.modules.find(item => item.id === id);
  item.audience = 'public'; item.visible = true;
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.equal((await f.request('/mosaic/api/page')).value.page.modules.some(item => item.id === id), false);
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: state.revision } });
  assert.equal((await f.request('/mosaic/api/page')).value.page.modules.some(item => item.id === id), true);
});

test('status data and private catalog require authentication, and snapshots are allowlisted', async t => {
  const f = await fixture(t);
  const marker = 'TOKEN-AND-MESSAGE-MUST-NOT-LEAK';
  const snapshot = { schemaVersion: 1, collectedAt: new Date().toISOString(), token: marker, server: { cpuPercent: 8.5, cpuCount: 4, memory: { used: 100, total: 500, available: 400 }, hostname: marker }, bot: { qqOnline: true, onebotConnected: true, astrbot: { running: true, restarts: 0, secret: marker }, messages: [marker] } };
  await writeFile(f.config.statusFile, JSON.stringify(snapshot));
  for (const route of ['/mosaic/api/private/page', '/mosaic/api/private/status', '/mosaic/api/admin/modules']) assert.equal((await f.request(route)).status, 401);
  const cookie = await f.login();
  const status = await f.request('/mosaic/api/private/status', { cookie });
  assert.equal(status.status, 200);
  assert.equal(status.value.stale, false);
  assert.equal(status.value.server.cpuPercent, 8.5);
  assert.equal(status.value.bot.qqOnline, true);
  assert.ok(!status.text.includes(marker));
  snapshot.collectedAt = new Date(Date.now() - 180_000).toISOString();
  await writeFile(f.config.statusFile, JSON.stringify(snapshot));
  assert.equal((await f.request('/mosaic/api/private/status', { cookie })).value.stale, true);
  await writeFile(f.config.statusFile, 'broken');
  assert.equal((await f.request('/mosaic/api/private/status', { cookie })).value.available, false);
});

test('status modules cannot be marked Public and unknown audiences are rejected', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  for (const type of ['server-status', 'bot-status']) {
    const page = structuredClone(state.draft);
    page.modules.find(item => item.type === type).audience = 'public';
    assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page } })).status, 400);
  }
  const page = structuredClone(state.draft);
  page.modules.find(item => item.type === 'intro').audience = 'everyone';
  assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page } })).status, 400);
  assert.equal((await f.request('/mosaic/api/admin/state', { cookie })).value.revision, state.revision);
});

test('legacy public modules remain public, and hidden saved drafts remain visible in Private', async t => {
  const f = await fixture(t);
  const filename = path.join(f.directory, 'content.json');
  const original = JSON.parse(await readFile(filename, 'utf8'));
  for (const page of [original.draft, original.published]) for (const item of page.modules) delete item.audience;
  original.draft.modules.find(item => item.type === 'intro').visible = false;
  original.draft.modules.find(item => item.type === 'intro').data.title = 'UNPUBLISHED-PRIVATE-PREVIEW';
  await writeFile(filename, JSON.stringify(original));
  await f.restart();
  const cookie = await f.login();
  const publicResponse = await f.request('/mosaic/api/page');
  assert.ok(publicResponse.value.page.modules.some(item => item.type === 'intro'));
  assert.ok(!publicResponse.text.includes('UNPUBLISHED-PRIVATE-PREVIEW'));
  const owner = await f.request('/mosaic/api/private/page', { cookie });
  assert.equal(owner.value.page.modules.length, original.draft.modules.length);
  assert.ok(owner.text.includes('UNPUBLISHED-PRIVATE-PREVIEW'));
});

test('width settings preserve draft/publish isolation, privacy, and content across replacement', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const beforePublic = (await f.request('/mosaic/api/page')).value.page;
  const ids = state.draft.modules.map(item => item.id);
  state.draft.modules.find(item => item.type === 'note').layout = { span: 4 };
  state.draft.modules.find(item => item.type === 'server-status').layout = { span: 12 };
  const expected = structuredClone(state.draft);
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.deepEqual((await f.request('/mosaic/api/page')).value.page, beforePublic);
  await f.restart();
  assert.deepEqual((await f.request('/mosaic/api/private/page', { cookie })).value.page, expected);
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: state.revision } });
  await f.restart();
  const published = (await f.request('/mosaic/api/page')).value.page;
  assert.deepEqual(published.modules.find(item => item.type === 'note').layout, { span: 4 });
  assert.ok(!published.modules.some(item => item.type === 'server-status'));
  state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  assert.deepEqual(state.draft.modules.map(item => item.id), ids);
  delete state.draft.modules.find(item => item.type === 'note').layout;
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.ok(!('layout' in state.draft.modules.find(item => item.type === 'note')));
  assert.deepEqual((await f.request('/mosaic/api/modules')).value.modules.find(item => item.id === 'note').layout, { span: 4, minWidth: 260 });
});

test('invalid frame settings are rejected without changing saved content', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  for (const layout of [null, 'wide', { span: -1 }, { span: 13 }, { span: '6' }, { span: 4, minWidth: 0 }, { aspectRatio: 1 }, { height: 0 }, { height: 1601 }, { height: 200.5 }, { height: '400' }]) {
    const page = structuredClone(state.draft);
    page.modules[0].layout = layout;
    assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page } })).status, 400);
  }
  assert.deepEqual((await f.request('/mosaic/api/admin/state', { cookie })).value, state);
});

test('dragged order and frame sizes survive save, replacement and publication without exposing private modules', async t => {
  const f = await fixture(t);
  const cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const oldPublic = (await f.request('/mosaic/api/page')).value.page;
  const original = structuredClone(state.draft.modules);
  const last = state.draft.modules.pop();
  state.draft.modules.unshift(last);
  state.draft.modules.find(item => item.type === 'note').layout = { span: 4, height: 248 };
  state.draft.modules.find(item => item.type === 'server-status').layout = { height: 320 };
  const expected = structuredClone(state.draft);
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: expected } })).value;
  await f.restart();
  assert.deepEqual((await f.request('/mosaic/api/private/page', { cookie })).value.page, expected);
  assert.deepEqual((await f.request('/mosaic/api/page')).value.page, oldPublic);
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: state.revision } });
  await f.restart();
  const published = (await f.request('/mosaic/api/page')).value.page;
  assert.deepEqual(published.modules, expected.modules.filter(item => item.audience === 'public'));
  for (const item of expected.modules) assert.deepEqual(item.data, original.find(before => before.id === item.id).data);
  state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const note = state.draft.modules.find(item => item.type === 'note');
  delete note.layout.height;
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  assert.deepEqual(state.draft.modules.find(item => item.id === note.id).layout, { span: 4 });
});


test('proxy egress requires login, allowlists fields and cannot be published', async t => {
  const f = await fixture(t);
  const at = new Date().toISOString();
  await writeFile(f.config.proxyStatusFile, JSON.stringify({ schemaVersion: 1, collectedAt: at,
    secret: 'NEVER-EXPOSE', groups: [{ name: 'X-AUTO', selected: 'node-1', secret: 'NEVER-EXPOSE' }],
    nodes: [{ name: 'node-1', ip: '8.8.8.8', reachable: true, checkedAt: at, uuid: 'NEVER-EXPOSE', server: 'hidden', delayMs: 120, delayAt: at, samples: 2, changes: 0 }] }));
  assert.equal((await f.request('/mosaic/api/private/proxies')).status, 401);
  const cookie = await f.login();
  const result = await f.request('/mosaic/api/private/proxies', { cookie });
  assert.equal(result.status, 200);
  assert.equal(result.value.nodes[0].ip, '8.8.8.8');
  assert.equal(result.value.nodes[0].delayMs, 120);
  assert.equal(result.value.stale, false);
  assert.ok(!result.text.includes('NEVER-EXPOSE'));
  assert.ok(!(await f.request('/mosaic/api/modules')).value.modules.some(m => m.id === 'proxy-nodes'));
  const state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const proxy = state.draft.modules.find(m => m.type === 'proxy-nodes');
  assert.equal(proxy.audience, 'private');
  assert.ok(!(await f.request('/mosaic/api/page')).value.page.modules.some(m => m.type === 'proxy-nodes'));
  proxy.audience = 'public'; proxy.visible = true;
  assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).status, 400);
});

test('instance saves are authenticated, revision checked and limited to draft data', async t => {
  const f = await fixture(t), cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  const before = structuredClone(state);
  const item = state.draft.modules.find(item => item.type === 'todo');
  const data = { ...item.data, items: [{ id: 'done', text: '<img src=x onerror=alert(1)>', done: true }] };
  const body = { revision: state.revision, id: item.id, data, audience: 'public', layout: { span: 1 } };
  assert.equal((await f.request('/mosaic/api/private/module', { method: 'PUT', body })).status, 401);
  assert.equal((await f.request('/mosaic/api/private/module', { method: 'PUT', body, cookie, requestOrigin: 'https://other.test' })).status, 403);
  const replies = await Promise.all([1, 2].map(() => f.request('/mosaic/api/private/module', { method: 'PUT', cookie, body })));
  assert.deepEqual(replies.map(result => result.status).sort(), [200, 409]);
  state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  assert.deepEqual(state.published, before.published);
  assert.deepEqual(state.draft.modules.filter(value => value.id !== item.id), before.draft.modules.filter(value => value.id !== item.id));
  assert.deepEqual(state.draft.modules.find(value => value.id === item.id), { ...item, data });
  assert.equal((await f.request('/mosaic/api/private/page', { cookie })).value.revision, state.revision);
  assert.equal((await f.request('/mosaic/api/private/module', { method: 'PUT', cookie, body: { ...body, revision: state.revision, id: 'missing' } })).status, 404);
  assert.equal((await f.request('/mosaic/api/private/module', { method: 'PUT', cookie, body: { ...body, revision: state.revision, data: { items: [{ id: 'bad', text: 'bad', done: 'yes' }] } } })).status, 400);
  await f.restart();
  assert.deepEqual((await f.request('/mosaic/api/admin/state', { cookie })).value, state);
});

test('page flow and module appearance survive publishing while invalid modes fail', async t => {
  const f = await fixture(t), cookie = await f.login();
  let state = (await f.request('/mosaic/api/admin/state', { cookie })).value;
  state.draft.flow = 'masonry';
  state.draft.modules.find(item => item.type === 'note').appearance = 'bare';
  state = (await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: state.draft } })).value;
  await f.request('/mosaic/api/admin/publish', { method: 'POST', cookie, body: { revision: state.revision } });
  const page = (await f.request('/mosaic/api/page')).value.page;
  assert.equal(page.flow, 'masonry');
  assert.equal(page.modules.find(item => item.type === 'note').appearance, 'bare');
  for (const mutate of [page => { page.flow = 'bad'; }, page => { page.modules[0].appearance = 'url(evil)'; }]) {
    const invalid = structuredClone(page); mutate(invalid);
    assert.equal((await f.request('/mosaic/api/admin/draft', { method: 'PUT', cookie, body: { revision: state.revision, page: invalid } })).status, 400);
  }
  const catalog = (await f.request('/mosaic/api/modules')).value.modules;
  assert.equal(catalog.find(meta => meta.id === 'todo').entry, 'modules/todo/client.js');
  assert.equal(catalog.find(meta => meta.id === 'note').entry, 'modules/note/index.js');
  assert.equal((await f.request('/mosaic/lab')).status, 200);
});
