// Runs in every HTTPS frame but only acts in a frame placed directly inside the configured Mosaic page.
(async () => {
  if (window === window.top || window.parent !== window.top) return;
  const { prefix } = await chrome.storage.sync.get('prefix');
  const mosaic = MosaicCore.parsePrefix(prefix);
  if (!mosaic || location.ancestorOrigins?.[0] !== mosaic.origin) return;

  // Cookies rewritten for this site only reach the page on its next load, so reload once.
  const reply = await chrome.runtime.sendMessage({ type: 'frame' });
  try {
    if (reply?.changed && !sessionStorage.getItem('mosaic-browser-reloaded')) { sessionStorage.setItem('mosaic-browser-reloaded', '1'); return location.reload(); }
  } catch { /* Storage is unavailable: continue with the cookies this load received. */ }

  const report = () => window.parent.postMessage({ mosaicBrowser: 1, type: 'navigated', url: location.href, title: document.title }, mosaic.origin);
  report();
  for (const type of ['load', 'popstate', 'hashchange']) addEventListener(type, report);
  window.navigation?.addEventListener('navigatesuccess', report);

  // Links that would open a new tab or replace the top page stay inside the frame instead.
  document.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    const target = (link.target || document.querySelector('base[target]')?.target || '').toLowerCase();
    if (['_blank', '_top', '_parent'].includes(target)) link.target = '_self';
  }, true);
  // The page-world script keeps window.open inside the frame once it hears this.
  document.dispatchEvent(new CustomEvent('mosaic-browser-activate'));
})();
