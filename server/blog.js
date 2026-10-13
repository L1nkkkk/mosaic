import { mkdir, readFile, readdir, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { renderMarkdown, plainText, externalLink } from './markdown.js';

// Posts are Markdown files in a GitHub repository. They are copied here and rendered once,
// so visitors only ever read the local copy and never wait on GitHub.
const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
const ASSET = /^[a-f0-9]{40}\.(png|jpe?g|gif|webp|avif)$/;
const SHA = /^[a-f0-9]{40}$/;
const SOURCE = /^posts\/[^/]+\.(md|html)$/i;
const PAGE = /^[a-f0-9]{40}\.html$/;
const MAX_POSTS = 300, MAX_SOURCE = 256 * 1024, MAX_PAGE = 1024 * 1024, MAX_IMAGE = 5 * 1024 * 1024, MAX_IMAGES = 400;
const INTERVAL = 5 * 60_000;

export function slugOf(file) {
  return path.posix.basename(file).replace(/\.(md|html)$/i, '').replace(/^\d{4}-\d{2}-\d{2}-?/, '').normalize('NFC').toLowerCase()
    .replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

const unquote = value => value.replace(/^(["'])(.*)\1$/, '$2').trim();
const day = value => { const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || ''); return match && !Number.isNaN(Date.parse(match[0])) ? match[0] : ''; };
const minutes = words => Math.max(1, Math.round(((words.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length + (words.replace(/[\u2e80-\u9fff\uf900-\ufaff]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length) / 400));
const clip = (text, length) => text.length > length ? `${text.slice(0, length - 2).trimEnd()}…` : text;
const labels = list => [...new Set(list.map(tag => unquote(tag.trim()).slice(0, 30)).filter(Boolean))].slice(0, 8);

// Followed links leave the frame a page post is shown in, except those within the page itself.
const OUTWARD = '<script>addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(a&&a.getAttribute("href").charAt(0)!=="#")a.target="_blank"},true)</script>';
const entities = text => text.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'", '#x27': "'" })[name.toLowerCase()]);

// A post written as a whole HTML page describes itself in its <title> and <meta name="…"> tags.
export function parsePage(source, file) {
  const head = /<head[\s>][\s\S]*?<\/head\s*>/i.exec(source)?.[0] || source.slice(0, 20_000), found = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\bname\s*=\s*["']?([\w:-]+)/i.exec(tag)?.[1].toLowerCase(), content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (name && content && !(name in found)) found[name] = entities(content[1] ?? content[2]).trim();
  }
  const name = path.posix.basename(file).replace(/\.html$/i, ''), title = entities(/<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] || '').replace(/\s+/g, ' ').trim();
  const words = entities(source.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '));
  const close = /<\/head\s*>/i.exec(source);
  return {
    title: (title || name).slice(0, 160), date: day(found.date || '') || day(name), tags: labels((found.tags || found.keywords || '').split(/[,，]/)),
    summary: clip((found.description || '').replace(/\s+/g, ' '), 160), draft: /^(true|yes|1)$/i.test(found.draft || ''), minutes: minutes(words),
    page: close ? source.slice(0, close.index) + OUTWARD + source.slice(close.index) : OUTWARD + source,
  };
}

// Front matter is a few `key: value` lines; a list may also be written one `- item` per line.
export function parsePost(source, file) {
  const match = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source), fields = {}; let last;
  for (const line of match ? match[1].split(/\r?\n/) : []) {
    const pair = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line), item = /^[ \t]*-[ \t]+(.+)$/.exec(line);
    if (pair) { last = pair[1].toLowerCase(); fields[last] = pair[2].trim(); }
    else if (item && last) fields[last] = [fields[last], item[1].trim()].filter(Boolean).join(',');
  }
  let body = match ? source.slice(match[0].length) : source.replace(/^﻿/, '');
  let title = unquote(fields.title || '');
  if (!title) {
    // Without a title in the front matter, the first heading names the post and leaves the text.
    const heading = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(body);
    if (heading) { title = plainText(heading[1]); body = body.slice(heading[0].length); }
  }
  const name = path.posix.basename(file).replace(/\.md$/i, '');
  const words = plainText(body), summary = unquote(fields.summary || fields.description || '') || plainText(body.split(/\r?\n[ \t]*\r?\n/).find(part => part.trim() && !/^\s*(#|```|~~~|!\[|>|\|)/.test(part)) || '');
  return {
    title: (title || name).slice(0, 160), date: day(unquote(fields.date || '')) || day(name),
    tags: labels(unquote(fields.tags || '').replace(/^\[|\]$/g, '').split(',')), summary: clip(summary, 160),
    draft: /^(true|yes|1)$/i.test(unquote(fields.draft || '')), minutes: minutes(words), body,
  };
}

export class Blog {
  constructor(directory, { repo = '', branch = 'main', token = '', fetcher = fetch } = {}) {
    if (repo && !/^[\w.-]{1,39}\/[\w.-]{1,100}$/.test(repo)) throw new Error('BLOG_REPO must look like owner/name');
    if (!/^[\w./-]{1,100}$/.test(branch)) throw new Error('BLOG_BRANCH is not a valid branch name');
    Object.assign(this, { directory: path.join(directory, 'blog'), repo, branch, token, fetcher });
    this.state = { repo, branch, posts: [] };
    this.queue = Promise.resolve();
  }
  get configured() { return Boolean(this.repo); }
  async initialize() {
    // This is a copy of the repository: one that cannot be read is simply fetched again.
    try {
      const saved = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8'));
      if (saved.repo === this.repo && saved.branch === this.branch && Array.isArray(saved.posts)) this.state = saved;
    } catch { /* Start from an empty copy. */ }
  }
  start() {
    if (!this.configured || this.timer) return;
    const check = () => { this.sync().catch(() => {}); };
    this.timer = setInterval(check, INTERVAL); this.timer.unref();
    check();
  }
  close() { clearInterval(this.timer); this.timer = undefined; }

  list(owner = false) {
    const posts = this.state.posts.filter(post => !post.draft).map(({ slug, title, date, tags, summary, minutes, page }) => ({ slug, title, date, tags, summary, minutes, ...(page ? { kind: 'page' } : {}) }));
    return { configured: this.configured, syncedAt: this.state.syncedAt || null, posts, ...(owner ? { status: { repo: this.repo, branch: this.branch, commit: this.state.commit || null, checkedAt: this.checkedAt || null, error: this.error || null } } : {}) };
  }
  post(slug) {
    const posts = this.state.posts.filter(post => !post.draft), index = posts.findIndex(post => post.slug === slug);
    if (index < 0) return null;
    const { slug: _, title, date, tags, summary, minutes, html, page } = posts[index], near = post => post ? { slug: post.slug, title: post.title } : null;
    return { slug, title, date, tags, summary, minutes, ...(page ? { page: `api/blog/page/${encodeURIComponent(slug)}` } : { html }), newer: near(posts[index - 1]), older: near(posts[index + 1]) };
  }
  async page(slug) {
    const name = this.state.posts.find(post => !post.draft && post.slug === slug)?.page;
    if (!name || !PAGE.test(name)) return null;
    try { return await readFile(path.join(this.directory, 'pages', name)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async asset(name) {
    if (!ASSET.test(name) || !this.state.posts.some(post => !post.draft && Object.values(post.images || {}).includes(name))) return null;
    try { return { file: await readFile(path.join(this.directory, 'assets', name)), type: IMAGES[name.split('.').at(-1)] }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  // One sync at a time; a failed one leaves the previous copy in place.
  sync(force = false) {
    if (!this.configured) return Promise.reject(Object.assign(new Error('还没有配置博客仓库（BLOG_REPO）。'), { status: 400 }));
    const operation = this.queue.then(async () => {
      try { await this.#sync(force); this.error = undefined; }
      catch (error) { this.error = error.public || '暂时连不上 GitHub，稍后会自动重试。'; throw Object.assign(new Error(this.error), { status: 503 }); }
      finally { this.checkedAt = new Date().toISOString(); }
      return this.list(true);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async #get(url, accept, limit, etag) {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: accept, 'User-Agent': 'mosaic-blog', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(etag ? { 'If-None-Match': etag } : {}) } });
    if (response.status === 304) { await response.body?.cancel().catch(() => {}); return { unchanged: true }; }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const limited = [403, 429].includes(response.status) && response.headers.get('x-ratelimit-remaining') === '0';
      throw Object.assign(new Error(`GitHub ${response.status}`), { public: limited ? 'GitHub 请求次数已用完，稍后会自动重试；配置 BLOG_TOKEN 可以提高额度。' : response.status === 404 ? '找不到博客仓库或分支，请检查 BLOG_REPO、BLOG_BRANCH；私有仓库需要 BLOG_TOKEN。' : [401, 403].includes(response.status) ? 'GitHub 拒绝了访问，请检查 BLOG_TOKEN。' : undefined });
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Response too large'), { public: '仓库里有超出大小限制的内容。' }); chunks.push(chunk); }
    return { body: Buffer.concat(chunks), etag: response.headers.get('etag') || undefined };
  }

  async #write(name, bytes) {
    const target = path.join(this.directory, name), temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  }

  async #sync(force) {
    const api = `https://api.github.com/repos/${this.repo}`;
    const head = await this.#get(`${api}/commits/${encodeURIComponent(this.branch)}`, 'application/vnd.github.sha', 200, force ? undefined : this.state.etag);
    if (head.unchanged) return;
    const commit = head.body.toString().trim();
    if (!SHA.test(commit)) throw new Error('Unexpected commit response');
    if (commit === this.state.commit && !force) { this.state.etag = head.etag; return; }
    const listing = JSON.parse((await this.#get(`${api}/git/trees/${commit}?recursive=1`, 'application/vnd.github+json', 8 * 1024 * 1024)).body.toString());
    if (listing.truncated || !Array.isArray(listing.tree)) throw Object.assign(new Error('Tree unavailable'), { public: '仓库文件太多，无法完整读取。' });
    const files = new Map(listing.tree.filter(entry => entry?.type === 'blob' && typeof entry.path === 'string' && SHA.test(entry.sha)).map(entry => [entry.path, entry]));
    const previous = new Map(this.state.posts.map(post => [post.path, post]));
    const posts = [], slugs = new Set(), saved = folder => readdir(path.join(this.directory, folder)).then(names => new Set(names), () => new Set());
    const pages = await saved('pages');
    // Dated file names sort newest last; the newest are kept when a repository holds too many.
    for (const file of [...files.keys()].filter(name => SOURCE.test(name)).sort().reverse().slice(0, MAX_POSTS)) {
      const entry = files.get(file), slug = slugOf(file), known = previous.get(file);
      const whole = /\.html$/i.test(file);
      if (!slug || slugs.has(slug) || entry.size > (whole ? MAX_PAGE : MAX_SOURCE)) continue;
      slugs.add(slug);
      if (whole) {
        if (known?.blob === entry.sha && (known.draft || pages.has(known.page))) { posts.push(known); continue; }
        const { page, draft, ...meta } = parsePage((await this.#get(`${api}/git/blobs/${entry.sha}`, 'application/vnd.github.raw', MAX_PAGE)).body.toString('utf8'), file);
        if (!draft) await this.#write(path.join('pages', `${entry.sha}.html`), page);
        posts.push(draft ? { slug, path: file, blob: entry.sha, draft: true } : { slug, path: file, blob: entry.sha, ...meta, page: `${entry.sha}.html` });
        continue;
      }
      const current = address => { const image = files.get(address); return image && image.size <= MAX_IMAGE ? `${image.sha}.${address.split('.').at(-1).toLowerCase()}` : ''; };
      if (known?.blob === entry.sha && Object.entries(known.images || {}).every(([address, name]) => current(address) === name)) { posts.push(known); continue; }
      const parsed = parsePost((await this.#get(`${api}/git/blobs/${entry.sha}`, 'application/vnd.github.raw', MAX_SOURCE)).body.toString('utf8'), file);
      if (parsed.draft) { posts.push({ slug, path: file, blob: entry.sha, draft: true }); continue; }
      const images = {};
      // Addresses in a post are relative to its own folder and stay inside the repository.
      const local = address => {
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(address)) return '';
        let decoded; try { decoded = decodeURIComponent(address.split(/[?#]/)[0]); } catch { return ''; }
        const resolved = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(file), decoded));
        return resolved.startsWith('../') || resolved === '..' ? '' : resolved;
      };
      const html = renderMarkdown(parsed.body, {
        image(address) {
          const target = local(address);
          if (!target || !IMAGES[target.split('.').at(-1).toLowerCase()]) return '';
          images[target] = current(target);
          return images[target] ? `api/blog/asset/${images[target]}` : '';
        },
        link(address) {
          const target = local(address);
          return target && SOURCE.test(target) && slugOf(target) ? `post/${encodeURIComponent(slugOf(target))}` : externalLink(address);
        },
      });
      const { body: _, draft: __, ...meta } = parsed;
      posts.push({ slug, path: file, blob: entry.sha, ...meta, images, html });
    }
    const wanted = new Set(posts.flatMap(post => Object.values(post.images || {})).filter(Boolean));
    if (wanted.size > MAX_IMAGES) throw Object.assign(new Error('Too many images'), { public: `文章里的图片超过 ${MAX_IMAGES} 张。` });
    const stored = await saved('assets');
    for (const name of wanted) if (!stored.has(name)) await this.#write(path.join('assets', name), (await this.#get(`${api}/git/blobs/${name.slice(0, 40)}`, 'application/vnd.github.raw', MAX_IMAGE)).body);
    posts.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.slug.localeCompare(b.slug));
    const next = { repo: this.repo, branch: this.branch, commit, etag: head.etag, syncedAt: new Date().toISOString(), posts };
    await this.#write('state.json', JSON.stringify(next));
    this.state = next;
    for (const name of stored) if (!wanted.has(name)) await unlink(path.join(this.directory, 'assets', name)).catch(() => {});
    for (const name of await saved('pages')) if (!posts.some(post => post.page === name)) await unlink(path.join(this.directory, 'pages', name)).catch(() => {});
  }
}
