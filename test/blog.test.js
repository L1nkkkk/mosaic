import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { renderMarkdown, plainText } from '../server/markdown.js';
import { Blog, parsePost, parsePage, slugOf } from '../server/blog.js';
import { createApp } from '../server/app.js';
import { passwordHash } from '../server/auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = content => createHash('sha1').update(content).digest('hex');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// A stand-in for the three GitHub endpoints the sync reads.
function github(files) {
  const hub = { files, calls: [], fail: false, commit: () => sha(JSON.stringify(Object.entries(hub.files).map(([name, content]) => [name, sha(content)]))) };
  hub.fetch = async (address, { headers }) => {
    const route = new URL(address).pathname; hub.calls.push(route.split('/').slice(4).join('/'));
    if (hub.fail) return new Response('{}', { status: 500 });
    if (route.endsWith('/commits/main')) {
      const tag = `"${hub.commit()}"`;
      return headers['If-None-Match'] === tag ? new Response(null, { status: 304 }) : new Response(hub.commit(), { headers: { etag: tag } });
    }
    if (route.includes('/git/trees/')) return Response.json({ truncated: false, tree: Object.entries(hub.files).map(([name, content]) => ({ path: name, type: 'blob', sha: sha(content), size: Buffer.byteLength(content) })) });
    const blob = Object.values(hub.files).find(content => route.endsWith(`/git/blobs/${sha(content)}`));
    return blob === undefined ? new Response('{}', { status: 404 }) : new Response(blob);
  };
  return hub;
}
// Whatever holds files in the directory is closed before it is removed.
async function temporary(t, close = () => {}) { const directory = await mkdtemp(path.join(tmpdir(), 'mosaic-blog-')); t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); }); return directory; }

test('markdown shows raw HTML as text and only links to safe addresses', () => {
  const html = renderMarkdown('<script>alert(1)</script> **粗** *斜* ~~删~~ `a<b`\n\n[坏](javascript:alert(1)) [好](https://example.com/a "标题") <https://example.com> https://example.org/x。\n\n![图](javascript:1) ![远](https://example.com/a.png)');
  assert.doesNotMatch(html, /<script|javascript:|<img/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; <strong>粗<\/strong> <em>斜<\/em> <del>删<\/del> <code>a&lt;b<\/code>/);
  assert.match(html, /<p>坏 <a href="https:\/\/example.com\/a" title="标题" target="_blank" rel="noopener noreferrer">好<\/a>/);
  assert.match(html, /<a href="https:\/\/example.org\/x"[^>]*>https:\/\/example.org\/x<\/a>。/);
  assert.match(html, /<p>图 <a href="https:\/\/example.com\/a.png"[^>]*>远<\/a><\/p>/);
  assert.equal(renderMarkdown('![a" onerror="x](pic.png)', { image: () => 'api/blog/asset/x.png' }), '<p><img src="api/blog/asset/x.png" alt="a&quot; onerror=&quot;x" loading="lazy" decoding="async"></p>');
});

test('markdown renders the blocks a post is written with', () => {
  assert.equal(renderMarkdown('# 一\n\n第一行\n第二行\nmixed line\nnext  \nbreak'), '<h2>一</h2>\n<p>第一行第二行\nmixed line\nnext<br>\nbreak</p>');
  assert.equal(renderMarkdown('```js\nconst a = "<b>";\n```'), '<pre><code data-lang="js">const a = &quot;&lt;b&gt;&quot;;\n</code></pre>');
  assert.equal(renderMarkdown('- 甲\n- 乙\n  1. 子\n  2. 孙\n- [x] 完成'), '<ul><li>甲</li><li>乙\n<ol><li>子</li><li>孙</li></ol></li><li class="task"><input type="checkbox" disabled checked> 完成</li></ul>');
  assert.equal(renderMarkdown('- 甲\n\n- 乙'), '<ul><li><p>甲</p></li><li><p>乙</p></li></ul>');
  assert.equal(renderMarkdown('> 引用\n> **续**\n\n---'), '<blockquote><p>引用\n<strong>续</strong></p></blockquote>\n<hr>');
  assert.equal(renderMarkdown('| 名 | 数 |\n| --- | ---: |\n| a\\|b | 1 |'), '<div class="md-table"><table><thead><tr><th>名</th><th data-align="right">数</th></tr></thead><tbody><tr><td>a|b</td><td data-align="right">1</td></tr></tbody></table></div>');
  assert.equal(renderMarkdown('snake_case_name 和 ***都有*** 2 * 3 * 4'), '<p>snake_case_name 和 <strong><em>都有</em></strong> 2 * 3 * 4</p>');
  assert.equal(plainText('## 标题\n\n一段 **重点** 与 [链接](https://a.example)。'), '标题 一段 重点 与 链接。');
  assert.doesNotThrow(() => renderMarkdown(`${'> '.repeat(40)}深\n${'*'.repeat(4000)}\n${'['.repeat(4000)}`));
});

test('front matter, file name and first heading describe a post', () => {
  const post = parsePost('---\ntitle: "写给 Mosaic"\ndate: 2026-10-13T08:00:00+08:00\ntags:\n  - 随笔\n  - web\nsummary: 一句话。\n---\n\n正文 body text。', 'posts/2026-10-01-hello.md');
  assert.deepEqual({ ...post, body: undefined }, { title: '写给 Mosaic', date: '2026-10-13', tags: ['随笔', 'web'], summary: '一句话。', draft: false, minutes: 1, body: undefined });
  const bare = parsePost('# 从标题来\n\n![图](a.png)\n\n第一段 **文字**。\n\n第二段。', 'posts/2026-09-30-Some_File Name.md');
  assert.deepEqual([bare.title, bare.date, bare.summary, bare.tags, bare.body.includes('从标题来')], ['从标题来', '2026-09-30', '第一段 文字。', [], false]);
  assert.equal(parsePost('---\ntags: [a, "b", a]\ndraft: true\n---\nx', 'posts/x.md').draft, true);
  assert.deepEqual(parsePost('---\ntags: [a, "b", a]\n---\nx', 'posts/x.md').tags, ['a', 'b']);
  assert.deepEqual([slugOf('posts/2026-09-30-Some_File Name.md'), slugOf('posts/你好，世界.md'), slugOf('posts/2026-01-01.md')], ['some-file-name', '你好世界', '']);
});

test('sync copies posts and their images, and only fetches what changed', async t => {
  const hub = github({
    'README.md': '# not a post',
    'posts/2026-10-01-first.md': '---\ntitle: 第一篇\ntags: [a]\n---\n见 [第二篇](2026-10-02-second.md)。\n\n![图](img/a.png)',
    'posts/2026-10-02-second.md': '# 第二篇\n\n![外](../outside.png) ![缺](img/missing.png)',
    'posts/2026-10-03-draft.md': '---\ndraft: true\n---\n没写完',
    'posts/img/a.png': png, 'outside.png': Buffer.concat([png, png]),
  });
  const directory = await temporary(t), blog = new Blog(directory, { repo: 'me/blog', fetcher: hub.fetch });
  await blog.initialize();
  assert.deepEqual(blog.list().posts, []);
  const synced = await blog.sync();
  assert.deepEqual(synced.posts.map(post => [post.slug, post.title, post.date]), [['second', '第二篇', '2026-10-02'], ['first', '第一篇', '2026-10-01']]);
  assert.equal(synced.status.commit, hub.commit());
  const first = blog.post('first');
  assert.match(first.html, new RegExp(`<a href="post/second">第二篇</a>。</p>\\n<p><img src="api/blog/asset/${sha(png)}.png" alt="图"`));
  assert.deepEqual([first.newer, first.older, blog.post('draft'), blog.post('missing')], [{ slug: 'second', title: '第二篇' }, null, null, null]);
  assert.match(blog.post('second').html, new RegExp(`<img src="api/blog/asset/${sha(Buffer.concat([png, png]))}.png" alt="外"[^>]*> 缺`));
  assert.deepEqual((await blog.asset(`${sha(png)}.png`)).file, png);
  assert.equal(await blog.asset(`${'0'.repeat(40)}.png`), null);
  assert.equal(await blog.asset('../state.json'), null);

  hub.calls.length = 0;
  await blog.sync();
  assert.deepEqual(hub.calls, ['commits/main']);

  // One post is edited, its picture replaced, and another removed.
  const next = Buffer.concat([png, Buffer.from('new')]);
  hub.files['posts/2026-10-01-first.md'] = '---\ntitle: 第一篇改\n---\n![图](img/b.png)';
  hub.files['posts/img/b.png'] = next; delete hub.files['posts/img/a.png']; delete hub.files['posts/2026-10-03-draft.md'];
  hub.calls.length = 0;
  await blog.sync();
  assert.deepEqual(hub.calls, ['commits/main', `git/trees/${hub.commit()}`, `git/blobs/${sha(hub.files['posts/2026-10-01-first.md'])}`, `git/blobs/${sha(next)}`]);
  assert.equal(blog.post('first').title, '第一篇改');
  assert.deepEqual((await readdir(path.join(directory, 'blog', 'assets'))).sort(), [`${sha(next)}.png`, `${sha(Buffer.concat([png, png]))}.png`].sort());

  // GitHub failing leaves the copy as it was, also across a restart.
  hub.files['posts/2026-10-04-new.md'] = '# 新的'; hub.fail = true;
  await assert.rejects(blog.sync(), { status: 503 });
  assert.equal(blog.list(true).status.error, '暂时连不上 GitHub，稍后会自动重试。');
  const restarted = new Blog(directory, { repo: 'me/blog', fetcher: hub.fetch });
  await restarted.initialize();
  assert.deepEqual(restarted.list().posts.map(post => post.slug), ['second', 'first']);
  hub.fail = false;
  assert.deepEqual((await restarted.sync()).posts.map(post => post.slug), ['new', 'second', 'first']);
  // A copy of another repository is not reused.
  const other = new Blog(directory, { repo: 'me/other', fetcher: hub.fetch });
  await other.initialize();
  assert.deepEqual(other.list().posts, []);
  assert.throws(() => new Blog(directory, { repo: 'https://github.com/me/blog' }), /owner\/name/);
});

test('posts are served to visitors only while a blog module is published', async t => {
  const hub = github({ 'posts/2026-10-01-你好.md': '# 你好\n\n![图](a.png)', 'posts/a.png': png });
  let app, plain;
  const directory = await temporary(t, () => { app.server.closeAllConnections(); return new Promise(resolve => app.server.close(resolve)); }), origin = 'https://mosaic.test', password = 'test-only-editor-password';
  const config = { root, dataDirectory: directory, statusFile: path.join(directory, 'status.json'), basePath: '/mosaic', publicOrigin: origin, passwordHash: await passwordHash(password), sessionSecret: 'test-session-secret-at-least-32-characters', version: 'test', commit: 'test' };
  app = await createApp({ ...config, blogRepo: 'me/blog', blogFetch: hub.fetch });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = `http://127.0.0.1:${app.server.address().port}/mosaic`;
  const request = (route, { cookie, ...options } = {}) => fetch(`${address}${route}`, { ...options, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  const cookie = (await request('/api/login', { method: 'POST', body: JSON.stringify({ password }) })).headers.get('set-cookie').split(';')[0];

  assert.equal((await request('/api/admin/blog/sync', { method: 'POST', body: '{}' })).status, 401);
  const synced = await request('/api/admin/blog/sync', { method: 'POST', body: '{}', cookie });
  assert.deepEqual([synced.status, (await synced.json()).status.repo], [200, 'me/blog']);
  const listed = await (await request('/api/blog')).json();
  assert.deepEqual([listed.configured, listed.status, listed.posts.map(post => post.slug)], [true, undefined, ['你好']]);
  const post = await (await request(`/api/blog/post?slug=${encodeURIComponent('你好')}`)).json();
  assert.equal(post.title, '你好');
  const image = await request(`/api/blog/asset/${sha(png)}.png`);
  assert.deepEqual([image.status, image.headers.get('content-type'), image.headers.get('cache-control')], [200, 'image/png', 'public, max-age=31536000, immutable']);
  assert.equal((await request('/api/blog/post?slug=nothing')).status, 404);
  const page = await request(`/post/${encodeURIComponent('你好')}`);
  assert.deepEqual([page.status, page.headers.get('content-type')], [200, 'text/html; charset=utf-8']);
  assert.equal((await request('/post/a/b')).status, 404);

  // Taking the module off the public page takes the posts with it.
  const state = await (await request('/api/admin/state', { cookie })).json();
  const kept = state.draft.modules.filter(item => item.type !== 'blog'), page2 = { ...state.draft, modules: kept };
  if (page2.spaces) for (const space of Object.values(page2.spaces)) space.items = space.items.filter(entry => kept.some(item => item.id === entry.id));
  const saved = await (await request('/api/admin/draft', { method: 'PUT', cookie, body: JSON.stringify({ revision: state.revision, page: page2 }) })).json();
  assert.equal((await request('/api/admin/publish', { method: 'POST', cookie, body: JSON.stringify({ revision: saved.revision }) })).status, 200);
  for (const route of ['/api/blog', `/api/blog/post?slug=${encodeURIComponent('你好')}`, `/api/blog/asset/${sha(png)}.png`]) assert.equal((await request(route)).status, 404);
  assert.equal((await (await request('/api/blog', { cookie })).json()).status.repo, 'me/blog');

  // Without a repository the module is empty and the app still starts.
  plain = await createApp({ ...config, dataDirectory: await temporary(t, () => plain.visitors.close()) });
  assert.deepEqual(plain.blog.list(true), { configured: false, syncedAt: null, posts: [], status: { repo: '', branch: 'main', commit: null, checkedAt: null, error: null } });
  await assert.rejects(plain.blog.sync(), { status: 400 });
});

test('a post can be a whole HTML page, shown in a frame that shares nothing with the site', async t => {
  const source = '<!doctype html><html><head><title>帧循环 &amp; 同步</title>\n<meta name="tags" content="vulkan, 课件">\n<meta name=description content="从一帧说起。">\n<style>p{color:red}</style></head><body><p>正文 body</p><script>document.cookie</script><a href="https://example.com">外</a></body></html>';
  const page = parsePage(source, 'posts/2026-10-13-Frame_Loop.html');
  assert.deepEqual({ ...page, page: undefined }, { title: '帧循环 & 同步', date: '2026-10-13', tags: ['vulkan', '课件'], summary: '从一帧说起。', draft: false, minutes: 1, page: undefined });
  assert.match(page.page, /<style>p\{color:red\}<\/style><script>addEventListener\("click"[^<]+<\/script><\/head>/);
  assert.equal(parsePage('<meta name="draft" content="true"><p>x</p>', 'posts/a.html').draft, true);
  assert.equal(slugOf('posts/2026-10-13-Frame_Loop.html'), 'frame-loop');

  const hub = github({ 'posts/2026-10-13-Frame_Loop.html': source, 'posts/2026-10-12-note.md': '# 笔记', 'posts/2026-10-11-hidden.html': '<meta name="draft" content="yes">' });
  let app;
  const directory = await temporary(t, () => { app.server.closeAllConnections(); return new Promise(resolve => app.server.close(resolve)); }), origin = 'https://mosaic.test';
  app = await createApp({ root, dataDirectory: directory, statusFile: path.join(directory, 'status.json'), basePath: '/mosaic', publicOrigin: origin, passwordHash: await passwordHash('test-only-editor-password'), sessionSecret: 'test-session-secret-at-least-32-characters', version: 'test', commit: 'test', blogRepo: 'me/blog', blogFetch: hub.fetch });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const address = `http://127.0.0.1:${app.server.address().port}/mosaic`;
  await app.blog.sync();
  const listed = await (await fetch(`${address}/api/blog`)).json();
  assert.deepEqual(listed.posts.map(post => [post.slug, post.kind]), [['frame-loop', 'page'], ['note', undefined]]);
  const post = await (await fetch(`${address}/api/blog/post?slug=frame-loop`)).json();
  assert.deepEqual([post.page, post.html, post.older], ['api/blog/page/frame-loop', undefined, { slug: 'note', title: '笔记' }]);
  const served = await fetch(`${address}/api/blog/page/frame-loop`);
  assert.deepEqual([served.status, served.headers.get('content-type'), served.headers.get('x-frame-options')], [200, 'text/html; charset=utf-8', null]);
  const policy = served.headers.get('content-security-policy');
  assert.match(policy, /^sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline';/);
  assert.match(policy, /frame-ancestors 'self'$/);
  assert.doesNotMatch(policy, /allow-same-origin|connect-src/);
  assert.equal(await served.text(), page.page);
  for (const name of ['note', 'hidden', 'nothing', '%E0%A4%A']) assert.equal((await fetch(`${address}/api/blog/page/${name}`)).status, 404);
  assert.deepEqual(await readdir(path.join(directory, 'blog', 'pages')), [`${sha(source)}.html`]);
  // An unchanged page is not downloaded again; a removed one is deleted here too.
  hub.files['posts/2026-10-12-note.md'] = '# 笔记改'; hub.calls.length = 0;
  await app.blog.sync();
  assert.equal(hub.calls.some(call => call === `git/blobs/${sha(source)}`), false);
  delete hub.files['posts/2026-10-13-Frame_Loop.html'];
  await app.blog.sync();
  assert.deepEqual([await readdir(path.join(directory, 'blog', 'pages')), (await fetch(`${address}/api/blog/page/frame-loop`)).status], [[], 404]);
});
