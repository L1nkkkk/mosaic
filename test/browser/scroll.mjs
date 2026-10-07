import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { passwordHash } from '../../server/auth.js';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const browser = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => candidate && existsSync(candidate));
assert.ok(browser, 'Install Chrome/Chromium or set CHROME_BIN to its executable path.');
const temporary = await mkdtemp(path.join(tmpdir(), 'mosaic-scroll-'));
let chrome, socket, server;
async function snapshot(ip) {
  await writeFile(path.join(temporary, 'proxies.json'), JSON.stringify({
    schemaVersion: 1, collectedAt: new Date().toISOString(), groups: [],
    nodes: Array.from({ length: 40 }, (_, index) => ({ name: 'Node ' + index, ip, samples: 2 })),
  }));
}
try {
  await snapshot('192.0.2.1');
  const app = await createApp({
    root, dataDirectory: path.join(temporary, 'data'), basePath: '',
    publicOrigin: 'http://localhost:3000', passwordHash: await passwordHash('local-test-only'),
    sessionSecret: 'local-browser-test-session-secret-only',
    version: 'test', commit: 'test',
    proxyStatusFile: path.join(temporary, 'proxies.json'),
  });
  const state = await app.store.read();
  const page = { title: 'Scroll test', modules: Array.from({ length: 10 }, (_, index) => ({
    id: 'card-' + index, type: 'proxy-nodes', audience: 'private', visible: false,
    layout: { span: 6, height: 500 },
    data: { title: 'Card ' + index },
  })) };
  await app.store.mutate(state.revision, value => ({ ...value, draft: page }));
  server = app.server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'local-test-only' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0].slice('mosaic_session='.length);
  chrome = spawn(browser, [
    '--headless=new', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-debugging-port=0', '--user-data-dir=' + path.join(temporary, 'chrome'),
    '--window-size=1200,800', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome start timeout')), 15000);
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    chrome.on('error', reject);
  });
  const port = new URL(endpoint).port;
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    if (!value.id) return;
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    clearTimeout(request.timeout);
    if (value.error) request.reject(new Error(JSON.stringify(value.error)));
    else request.resolve(value.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Browser command timed out: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command('Page.enable');
  await command('Network.setCookie', { name: 'mosaic_session', value: cookie, url: base, httpOnly: true });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: 'const originalInterval = window.setInterval; window.setInterval = (callback, delay, ...args) => { if (delay === 30000) window.refreshForTest = callback; return originalInterval(callback, delay, ...args); };' });
  // Trigger the captured production timer callback instead of waiting 30 seconds.
  // The real app, renderer, CSS, API and browser layout engine remain in use.
  for (const scenario of [
    { route: 'private', width: 1200, manual: false, focus: false },
    { route: 'private', width: 1200, manual: true, focus: true },
    { route: 'private', width: 390, manual: false, focus: true },
    { route: 'edit', width: 1600, manual: false, focus: true },
  ]) {
    await snapshot('192.0.2.1');
    await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: 800, deviceScaleFactor: 1, mobile: false });
    await command('Page.navigate', { url: base + '/' + scenario.route });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      ready = await evaluate('Boolean(window.refreshForTest && document.querySelectorAll(".module-slot").length === 10)');
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(ready, 'Application must finish loading before testing scroll');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await snapshot('192.0.2.2');
    const result = await evaluate(`(async () => {
      const scenario = ${JSON.stringify(scenario)};
      const grid = document.querySelector(scenario.route === 'edit' ? '#preview-page' : '#private-page');
      window.scrollTo(0, 1800);
      await new Promise(resolve => requestAnimationFrame(resolve));
      grid.querySelectorAll('.module-content').forEach(content => { content.scrollTop = 1200; });
      if (scenario.focus) grid.querySelector('.module-content').focus({ preventScroll: true });
      const before = window.scrollY;
      const innerBefore = [...grid.querySelectorAll('.module-content')].map(content => content.scrollTop);
      const refreshed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Refresh did not render')); }, 5000);
        const observer = new MutationObserver(() => {
          observer.disconnect(); clearTimeout(timeout);
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        observer.observe(grid, { childList: true, subtree: true });
      });
      if (scenario.manual) document.querySelector('#refresh-private').click();
      else window.refreshForTest();
      await refreshed;
      return {
        before, after: window.scrollY, innerBefore,
        innerAfter: [...grid.querySelectorAll('.module-content')].map(content => content.scrollTop),
        updated: grid.textContent.includes('192.0.2.2'),
        focused: document.activeElement.matches('.module-content'),
      };
    })()`);
    const name = scenario.route + ' ' + scenario.width + 'px ' + (scenario.manual ? 'manual' : 'automatic');
    assert.ok(result.before > 500, name + ': fixture must be scrolled down');
    assert.ok(result.innerBefore.every(position => position > 0), name + ': modules must be scrolled inside');
    assert.equal(result.after, result.before, name + ': refresh must preserve page scroll');
    assert.deepEqual(result.innerAfter, result.innerBefore, name + ': refresh must preserve module scroll');
    assert.ok(result.updated, name + ': fresh resource data must still render');
    if (scenario.focus) assert.ok(result.focused, name + ': module keyboard focus must survive');
    console.log(name + ': scroll ' + result.before + ' → ' + result.after + '; resources and inner scroll verified');
  }
} finally {
  socket?.close();
  if (chrome) { chrome.kill('SIGTERM'); await once(chrome, 'exit').catch(() => {}); }
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
