import { escape } from '../../web/ui.js';

// The reading page for one post. The article HTML comes from the server's own renderer,
// which only emits a fixed set of tags, so it is placed as it arrives.
export async function openPost({ root, slug, request, footer = '' }) {
  if (!document.querySelector('link[data-module-style="blog"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = new URL('modules/blog/style.css', document.baseURI); style.dataset.moduleStyle = 'blog';
    await new Promise(resolve => { style.onload = style.onerror = resolve; document.head.append(style); });
  }
  let post;
  try { post = slug ? await request(`blog/post?slug=${encodeURIComponent(slug)}`) : null; }
  catch (error) { if (error.status !== 404) throw error; }
  document.title = post ? post.title : '没有这篇文章';
  const near = (item, label, side) => item ? `<a class="post-near" data-side="${side}" href="post/${encodeURIComponent(item.slug)}"><span>${label}</span><strong>${escape(item.title)}</strong></a>` : '<span></span>';
  // A post that is a whole page keeps its own layout: it gets the screen below a narrow bar, in a frame that shares nothing with this site.
  if (post?.page) {
    root.classList.add('post-wide');
    root.innerHTML = `<header class="post-bar"><a class="post-back" href="./"><span aria-hidden="true">←</span> 返回主页</a><strong class="post-bar-title">${escape(post.title)}</strong><button class="icon-button" type="button" data-theme-toggle></button></header><main id="main" class="post-page"><iframe class="post-frame" title="${escape(post.title)}" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="${escape(post.page)}"></iframe></main>`;
    return;
  }
  root.innerHTML = `<div class="post-progress" aria-hidden="true"></div><header class="post-bar"><a class="post-back" href="./"><span aria-hidden="true">←</span> 返回主页</a><button class="icon-button" type="button" data-theme-toggle></button></header><main id="main" class="post-page">${post
    ? `<article class="post"><header class="post-head">${post.date ? `<time datetime="${escape(post.date)}">${escape(post.date.replaceAll('-', '.'))}</time>` : ''}<h1>${escape(post.title)}</h1><p class="post-meta">${[`约 ${post.minutes} 分钟`, ...post.tags.map(tag => `#${escape(tag)}`)].join('<span aria-hidden="true"> · </span>')}</p></header><div class="post-body">${post.html}</div></article><nav class="post-nav" aria-label="其他文章">${near(post.newer, '← 较新', 'newer')}${near(post.older, '较早 →', 'older')}</nav>`
    : '<article class="post post-missing"><h1>没有这篇文章</h1><p>它可能改了名字，或者还没有公开。</p><a class="post-back" href="./"><span aria-hidden="true">←</span> 返回主页</a></article>'}</main>${footer}`;
}
