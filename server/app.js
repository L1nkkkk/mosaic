import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { AppearanceStore, MAX_BACKGROUND_BYTES } from './appearance.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadModules, initialPage, validatePage, publicPage, savePageDraft } from './modules.js';
import { PageStore, ConflictError } from './store.js';
import { createAuth } from './auth.js';
import { readStatus } from './status.js';
import { readProxies } from './proxies.js';

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

export async function createApp(config) {
  const { root, dataDirectory, basePath, publicOrigin } = config;
  if (basePath && !/^\/[a-zA-Z0-9_-]+$/.test(basePath)) throw new Error('BASE_PATH must be empty or one path segment');
  const registry = await loadModules(path.join(root, 'modules'));
  const store = new PageStore(dataDirectory, initialPage(registry));
  await store.initialize();
  const appearance = new AppearanceStore(dataDirectory);
  await appearance.initialize();
  // Preflight deployments must reject modules that cannot read existing content.
  const existing = await store.read();
  validatePage(existing.draft, registry);
  validatePage(existing.published, registry);
  const auth = createAuth({ hash: config.passwordHash, secret: config.sessionSecret, secure: publicOrigin.startsWith('https:'), basePath });
  const loginAttempts = new Map();
  const index = (await readFile(path.join(root, 'web/index.html'), 'utf8')).replaceAll('__BASE__', `${basePath}/`);
  const catalog = privateAccess => ({ modules: [...registry.values()].filter(module => privateAccess || !module.meta.privateOnly).map(module => ({ ...module.meta, entry: `modules/${module.meta.id}/${module.entry}` })) });

  function json(response, status, value, headers = {}) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    response.end(JSON.stringify(value));
  }

  async function body(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('请求格式不正确。'), { status: 415 });
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 128 * 1024) throw Object.assign(new Error('页面内容过大。'), { status: 413 });
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString());
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw Object.assign(new Error('请求内容不是有效 JSON 对象。'), { status: 400 }); }
  }

  function asset(request, response, file, type, immutable = false) {
    const etag = `"${createHash('sha256').update(file).digest('hex')}"`;
    const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' };
    const matches = request.headers['if-none-match']?.split(',').map(value => value.trim().replace(/^W\//, ''));
    if (matches?.includes(etag) || matches?.includes('*')) { response.writeHead(304, headers); return response.end(); }
    response.writeHead(200, { ...headers, 'Content-Length': file.length });
    response.end(request.method === 'HEAD' ? undefined : file);
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, publicOrigin);
      if (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) return json(response, 404, { error: 'Not found' });
      const route = url.pathname.slice(basePath.length) || '/';
      const method = request.method;
      if (!['GET', 'HEAD', 'POST', 'PUT'].includes(method)) return json(response, 405, { error: 'Method not allowed' });
      if (['POST', 'PUT'].includes(method) && request.headers.origin !== publicOrigin) return json(response, 403, { error: '请求来源不正确，请从本站编辑台操作。' });

      if (route === '/api/health' && method === 'GET') return json(response, 200, { ok: true, version: config.version, commit: config.commit });
      if (route === '/api/page' && method === 'GET') {
        const state = await store.read();
        const page = publicPage(state.published, registry);
        return json(response, 200, { page, publishedAt: state.publishedAt, version: config.version, commit: config.commit });
      }
      if (route === '/api/appearance' && method === 'GET') return json(response, 200, appearance.publicState(await appearance.read()));
      if (route.startsWith('/api/background/') && ['GET', 'HEAD'].includes(method)) {
        const file = await appearance.image(route.slice('/api/background/'.length));
        if (file) return asset(request, response, file, 'image/webp', true);
      }
      if (route === '/api/modules' && method === 'GET') return json(response, 200, catalog(false));
      if (route === '/api/session' && method === 'GET') return json(response, 200, { authenticated: auth.authenticated(request) });
      if (route === '/api/login' && method === 'POST') {
        // Only the trusted reverse proxy can reach the production HTTP listener.
        const ip = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',').at(-1).trim().slice(0, 64);
        const now = Date.now();
        for (const [key, value] of loginAttempts) if (value.until < now) loginAttempts.delete(key);
        const attempts = loginAttempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
        if (attempts.count >= 10 || loginAttempts.size > 5000) return json(response, 429, { error: '尝试次数较多，请稍后再试。' }, { 'Retry-After': '900' });
        const payload = await body(request);
        attempts.count++;
        loginAttempts.set(ip, attempts);
        if (!await auth.verifyPassword(payload.password)) {
          return json(response, 401, { error: '密码不正确。' });
        }
        loginAttempts.delete(ip);
        return json(response, 200, { ok: true }, { 'Set-Cookie': auth.loginCookie() });
      }
      if (route === '/api/logout' && method === 'POST') return json(response, 200, { ok: true }, { 'Set-Cookie': auth.logoutCookie() });
      if (route.startsWith('/api/private/')) {
        if (!auth.authenticated(request)) return json(response, 401, { error: '请先登录私人空间。' });
        if (route === '/api/private/proxies' && method === 'GET') return json(response, 200, await readProxies(config.proxyStatusFile));
        if (route === '/api/private/page' && method === 'GET') {
          const state = await store.read();
          return json(response, 200, { page: validatePage(state.draft, registry), revision: state.revision, updatedAt: state.updatedAt, version: config.version });
        }
        if (route === '/api/private/module' && method === 'PUT') {
          const payload = await body(request);
          const next = await store.mutate(payload.revision, state => {
            const item = state.draft.modules.find(item => item.id === payload.id);
            if (!item) throw Object.assign(new Error('模块不存在。'), { status: 404 });
            try { item.data = registry.get(item.type).validate(payload.data); }
            catch (error) { throw Object.assign(new Error(error.message), { status: 400 }); }
            if (Buffer.byteLength(JSON.stringify(state.draft)) > 120 * 1024) throw Object.assign(new Error('页面内容过大。'), { status: 413 });
            // Only this instance's draft data changes. Publication is explicit.
            return state;
          });
          return json(response, 200, { page: validatePage(next.draft, registry), revision: next.revision, updatedAt: next.updatedAt });
        }
        if (route === '/api/private/status' && method === 'GET') return json(response, 200, await readStatus(config.statusFile));
      }
      if (route.startsWith('/api/admin/')) {
        if (!auth.authenticated(request)) return json(response, 401, { error: '请先登录编辑台。' });
        if (route === '/api/admin/appearance' && method === 'PUT') {
          const payload = await body(request);
          return json(response, 200, await appearance.save(payload.revision, payload.background));
        }
        if (route === '/api/admin/background' && method === 'PUT') {
          if (request.headers['content-type'] !== 'image/webp') return json(response, 415, { error: '请选择图片并通过外观设置上传。' });
          const revision = url.searchParams.get('revision');
          if (!revision || !/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))) return json(response, 400, { error: '背景版本不正确。' });
          let size = 0; const chunks = [];
          for await (const chunk of request) {
            size += chunk.length;
            if (size > MAX_BACKGROUND_BYTES) throw Object.assign(new Error('图片压缩后仍过大，请换一张图片。'), { status: 413 });
            chunks.push(chunk);
          }
          return json(response, 200, await appearance.save(Number(revision), null, Buffer.concat(chunks)));
        }
        if (route === '/api/admin/modules' && method === 'GET') return json(response, 200, catalog(true));
        if (route === '/api/admin/state' && method === 'GET') {
          const state = await store.read();
          return json(response, 200, { ...state, draft: validatePage(state.draft, registry), published: validatePage(state.published, registry) });
        }
        if (route === '/api/admin/draft' && method === 'PUT') {
          const payload = await body(request);
          let page;
          try { page = validatePage(payload.page, registry); } catch (error) { return json(response, 400, { error: error.message }); }
          return json(response, 200, await store.mutate(payload.revision, state => savePageDraft(state, page)));
        }
        if (route === '/api/admin/publish' && method === 'POST') {
          const payload = await body(request);
          return json(response, 200, await store.mutate(payload.revision, state => ({ ...state, published: validatePage(state.draft, registry), publishedAt: new Date().toISOString() })));
        }
      }
      if (method === 'GET' && ['/', '/public', '/public/', '/private', '/private/', '/edit', '/edit/', '/lab', '/lab/'].includes(route)) {
        const state = appearance.publicState(await appearance.read());
        const nonce = randomBytes(16).toString('base64');
        response.setHeader('Content-Security-Policy', response.getHeader('Content-Security-Policy').replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(index.replace('__SITE_STYLE__', `<style nonce="${nonce}">:root{--wallpaper-image:${state.backgroundUrl ? `url("${basePath}/${state.backgroundUrl}")` : 'none'}}</style>`));
      }
      if ((method === 'GET' || method === 'HEAD') && (route.startsWith('/web/') || route.startsWith('/modules/'))) {
        const decoded = decodeURIComponent(route);
        const segments = decoded.split('/');
        if (segments.some(segment => segment.startsWith('.') || segment.includes('\\')) || !TYPES[path.extname(decoded)]) return json(response, 404, { error: 'Not found' });
        const filename = path.resolve(root, `.${decoded}`);
        if (!filename.startsWith(`${root}${path.sep}`)) return json(response, 404, { error: 'Not found' });
        try {
          const file = await readFile(filename);
          return asset(request, response, file, TYPES[path.extname(filename)]);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return json(response, 404, { error: 'Not found' });
    } catch (error) {
      const status = error instanceof ConflictError ? 409 : error.status || 500;
      if (status === 500) console.error('Request failed:', error.name);
      if (!response.headersSent) json(response, status, { error: status === 500 ? '暂时无法完成操作，请稍后再试。' : error.message });
      else response.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, store, registry, appearance };
}
