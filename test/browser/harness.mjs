import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { createApp } from '../../server/app.js';
import { passwordHash } from '../../server/auth.js';

export async function withBrowser(run, options = {}) {
  const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const browser = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(candidate => candidate && existsSync(candidate));
  assert.ok(browser, 'Install Chrome/Chromium or set CHROME_BIN.');
  const temporary = await mkdtemp(path.join(tmpdir(), 'mosaic-runtime-'));
  let chrome, socket, server;
  try {
    const probe = createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const base = 'http://127.0.0.1:' + port;
    const app = await createApp({ root, dataDirectory: path.join(temporary, 'data'), statusFile: path.join(temporary, 'data/status.json'), basePath: '', publicOrigin: base,
      passwordHash: await passwordHash('local-test-only'), sessionSecret: 'local-browser-test-session-secret-only', version: 'test', commit: 'test', ...options });
    server = app.server.listen(port, '127.0.0.1'); await once(server, 'listening');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'local-test-only' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0].slice('mosaic_session='.length);
    chrome = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', '--user-data-dir=' + path.join(temporary, 'chrome'), '--window-size=1440,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let output = ''; const timeout = setTimeout(() => reject(new Error('Chrome start timeout')), 15000);
      chrome.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      chrome.on('error', reject);
    });
    const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl); await once(socket, 'open');
    let next = 0; const pending = new Map();
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data), request = pending.get(value.id);
      if (!request) return; pending.delete(value.id); clearTimeout(request.timeout);
      if (value.error) request.reject(new Error(JSON.stringify(value.error))); else request.resolve(value.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next; const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Browser timed out: ' + method)); }, 15000);
      pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let attempt = 0; attempt < 160; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error('Timed out waiting for ' + expression);
    };
    await command('Page.enable');
    await command('Network.setCookie', { name: 'mosaic_session', value: cookie, url: base, httpOnly: true });
    await command('Page.addScriptToEvaluateOnNewDocument', { source: 'const originalInterval = window.setInterval; window.setInterval = (callback, delay, ...args) => { if (delay === 30000) window.refreshForTest = callback; return originalInterval(callback, delay, ...args); };' });
    await run({ app, base, command, evaluate, waitFor });
  } finally {
    socket?.close();
    if (chrome) { chrome.kill('SIGTERM'); await once(chrome, 'exit').catch(() => {}); }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    // Chrome subprocesses may briefly finish profile writes after the parent exits.
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
