// Page-world half of content-frame.js: dormant until that script has verified the Mosaic parent.
document.addEventListener('mosaic-browser-activate', () => {
  const open = window.open;
  window.open = function (url, target) {
    if (url && (!target || target === '_blank')) { location.assign(url); return window; }
    return open.apply(this, arguments);
  };
  // Chrome ignores a script-written cookie in a cross-site frame unless it is SameSite=None.
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return cookie.get.call(document); },
    set(value) {
      const text = String(value);
      cookie.set.call(document, /;\s*samesite\s*=\s*(strict|none)/i.test(text) ? text : `${text.replace(/;\s*samesite\s*=[^;]*/i, '')}; SameSite=None; Secure`);
    },
  });
}, { once: true });
