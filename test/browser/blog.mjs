import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withBrowser } from './harness.mjs';

const sha = content => createHash('sha1').update(content).digest('hex');
// The page reports what it could reach from inside its frame.
const page = `<!doctype html><html><head><title>课件</title><style>body{background:rgb(1,2,3)}</style></head><body><a id="in" href="#x">内</a><a id="out" href="https://example.com/">外</a><script>
(async () => {
  let cookie, store, request;
  try { cookie = document.cookie; } catch { cookie = 'denied'; }
  try { localStorage.setItem('a', '1'); store = 'open'; } catch { store = 'denied'; }
  try { await fetch('/api/session'); request = 'open'; } catch { request = 'denied'; }
  document.getElementById('in').click(); document.getElementById('out').addEventListener('click', event => event.preventDefault()); document.getElementById('out').click();
  parent.postMessage({ blogProbe: { origin, cookie, store, request, background: getComputedStyle(document.body).backgroundColor, inward: document.getElementById('in').target, outward: document.getElementById('out').target } }, '*');
})();
</script></body></html>`;
const files = { 'posts/2026-10-13-lesson.html': page, 'posts/2026-10-12-words.md': '---\ntitle: 文字\n---\n正文 **粗体**。\n\n<script>window.injected = true</script>' };
const commit = sha(JSON.stringify(files));
const blogFetch = async address => {
  const route = new URL(address).pathname;
  if (route.endsWith('/commits/main')) return new Response(commit, { headers: { etag: `"${commit}"` } });
  if (route.includes('/git/trees/')) return Response.json({ truncated: false, tree: Object.entries(files).map(([name, content]) => ({ path: name, type: 'blob', sha: sha(content), size: Buffer.byteLength(content) })) });
  const blob = Object.values(files).find(content => route.endsWith(`/git/blobs/${sha(content)}`));
  return blob === undefined ? new Response('{}', { status: 404 }) : new Response(blob);
};

await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  await app.blog.sync();
  const state = await app.store.read(), card = { id: 'blog', type: 'blog', audience: 'public', visible: true, data: { title: '文章', count: 5, tag: '' } };
  await app.store.mutate(state.revision, s => ({ ...s, draft: { title: '博客', modules: [card] }, published: { title: '博客', modules: [card] } }));
  await command('Page.navigate', { url: base + '/' });
  await waitFor('document.querySelectorAll(".blog-list a").length===2');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.blog-list a')].map(a => [new URL(a.href).pathname, a.querySelector('strong').textContent, a.querySelector('.blog-foot').textContent.includes('可交互')])`), [['/post/lesson', '课件', true], ['/post/words', '文字', false]]);

  // A Markdown post is read in the page itself; markup in its source stays text.
  await command('Page.navigate', { url: base + '/post/words' });
  await waitFor('document.querySelector(".post-body")');
  assert.deepEqual(await evaluate(`[document.title, document.querySelector('.post h1').textContent, document.querySelector('.post-body strong').textContent, window.injected === undefined, document.querySelector('.post-body').textContent.includes('<script>'), document.querySelector('.post-near strong').textContent]`), ['文字', '文字', '粗体', true, true, '课件']);

  // A page post runs, with its own styles, in a frame that has no access to this site.
  await evaluate(`window.addEventListener('message', event => { if (event.data?.blogProbe) window.blogProbe = { ...event.data.blogProbe, from: event.origin }; })`);
  await evaluate(`history.pushState(null, '', '/post/lesson'); import('/modules/blog/reader.js').then(m => m.openPost({ root: document.querySelector('.post-shell'), slug: 'lesson', request: route => fetch('/api/' + route).then(r => r.json()) })); 0`);
  await waitFor('window.blogProbe');
  assert.deepEqual(await evaluate('window.blogProbe'), { origin: 'null', cookie: 'denied', store: 'denied', request: 'denied', background: 'rgb(1, 2, 3)', inward: '', outward: '_blank', from: 'null' });
  assert.deepEqual(await evaluate(`(() => { const frame = document.querySelector('.post-frame'), box = frame.getBoundingClientRect(); let inside; try { inside = frame.contentDocument; } catch { inside = null; } return [inside, Math.round(box.width) === innerWidth, box.height > innerHeight * .8, document.documentElement.scrollHeight <= innerHeight, document.querySelector('.post-bar-title').textContent]; })()`), [null, true, true, true, '课件']);
  await command('Page.navigate', { url: base + '/post/lesson' });
  await waitFor('document.querySelector(".post-frame") && document.title==="课件"');
}, { blogRepo: 'me/blog', blogFetch });
console.log('Blog card, reading page and isolated page posts verified');
