// One shared animation clock. Each host owns its DOM, observers and cleanup.
const animated = new Set();
let frame;
let previous;
function schedule() {
  if (!frame && animated.size) frame = requestAnimationFrame(tick);
}
function tick(time) {
  frame = undefined;
  const delta = previous === undefined ? 0 : Math.min(time - previous, 100);
  previous = time;
  for (const host of [...animated]) host.draw(time, delta);
  if (animated.size) schedule(); else previous = undefined;
}
function animate(host, enabled) {
  if (enabled) animated.add(host); else animated.delete(host);
  if (!animated.size) { cancelAnimationFrame(frame); frame = undefined; previous = undefined; }
  schedule();
}

export function createModuleHost(element, module, options) {
  const controller = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let instance, disposed = false, failed = false, mounted = false;
  let intersecting = false, paused = false, active = false;
  let current = options;
  let size = { width: 0, height: 0, pixelRatio: Math.min(devicePixelRatio || 1, 2) };
  let signature;
  const surface = document.createElement('div'); surface.className = 'module-surface';
  element.append(surface);
  const root = module.meta?.isolation === 'shadow' ? surface.attachShadow({ mode: 'open' }) : surface;
  if (root !== surface) {
    const style = document.createElement('link'); style.rel = 'stylesheet';
    style.href = new URL(`modules/${module.meta.id}/style.css`, document.baseURI);
    root.append(style);
  }
  const context = {
    root, id: options.id, signal: controller.signal,
    get data() { return structuredClone(current.data); },
    get resource() { return current.resource; },
    get size() { return { ...size }; },
    get appearance() { return current.appearance || 'card'; },
    get theme() { const css = getComputedStyle(surface); return Object.fromEntries(['paper', 'ink', 'muted', 'line', 'violet', 'white'].map(key => [key, css.getPropertyValue('--' + key).trim()])); },
    get writable() { return Boolean(current.writable); },
    get view() { return current.view || 'public'; },
    get reducedMotion() { return reduced.matches; },
    request: route => current.request(route),
    save: async data => {
      if (disposed || failed) throw new Error('模块已关闭。');
      if (!current.writable) throw new Error('此预览只可浏览。');
      return current.save(structuredClone(data));
    },
    invalidate: () => { if (active) host.draw(performance.now(), 0); },
  };
  function fail(error) {
    if (failed || disposed) return;
    failed = true; active = false; animate(host, false); controller.abort();
    try { instance?.dispose?.(); } catch { /* Other modules remain live. */ }
    resize.disconnect(); visibility.disconnect();
    element.replaceChildren();
    const message = document.createElement('article'); message.className = 'module-error';
    message.textContent = '这块内容暂时无法显示，内容已保留。'; element.append(message);
    options.onError?.(error);
  }
  function invoke(method, ...args) {
    if (failed || disposed) return;
    try { return instance?.[method]?.(...args); } catch (error) { fail(error); }
  }
  function activity() {
    const next = mounted && !disposed && !failed && intersecting && !document.hidden && !paused;
    if (active !== next) { active = next; invoke('setActive', active); }
    animate(host, active && !failed && !disposed && Boolean(instance?.frame) && !reduced.matches && module.meta?.animation === 'continuous');
    if (active) host.draw(performance.now(), 0);
  }
  const host = {
    update(next) {
      current = next;
      try {
        const nextSignature = JSON.stringify([next.data, next.resource, Boolean(next.writable), next.appearance]);
        if (nextSignature === signature) return;
        signature = nextSignature;
        const top = element.scrollTop;
        invoke('update', structuredClone(next.data), next.resource);
        element.scrollTop = top;
        if (active) host.draw(performance.now(), 0);
      } catch (error) { fail(error); }
    },
    draw(time, delta) { invoke('frame', time, delta); },
    pause(value) { paused = value; activity(); },
    inspect() { return { mounted, active, failed, disposed, reducedMotion: reduced.matches, size: { ...size } }; },
    dispose() {
      if (disposed) return;
      invoke('setActive', false); animate(host, false);
      disposed = true; active = false; controller.abort(); resize.disconnect(); visibility.disconnect();
      if (!failed) { try { instance?.dispose?.(); } catch (error) { options.onError?.(error); } }
      element.replaceChildren();
    },
  };
  const resize = new ResizeObserver(entries => {
    const box = entries[0].contentRect;
    size = { width: box.width, height: box.height, pixelRatio: Math.min(devicePixelRatio || 1, 2) };
    invoke('resize', { ...size });
    if (active) host.draw(performance.now(), 0);
  });
  const visibility = new IntersectionObserver(entries => { intersecting = entries.at(-1).isIntersecting; activity(); });
  document.addEventListener('visibilitychange', activity, { signal: controller.signal });
  reduced.addEventListener('change', activity, { signal: controller.signal });
  try {
    if (typeof module.mount === 'function') {
      instance = module.mount(context);
      if (!instance || typeof instance !== 'object' || typeof instance.then === 'function') throw new Error('mount must synchronously return a lifecycle object');
    } else if (typeof module.render === 'function') {
      instance = { update(data, resource) { const html = module.render(data, resource); if (surface.innerHTML !== html) surface.innerHTML = html; } };
    } else throw new Error('Missing mount or render');
    mounted = true; host.update(options);
    if (!failed) { resize.observe(element); visibility.observe(element); activity(); }
  } catch (error) { fail(error); }
  return host;
}
