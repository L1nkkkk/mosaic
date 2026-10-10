// Marks the configured Mosaic page so the browser module knows framing is available.
(async () => {
  if (window !== window.top) return;
  const { prefix } = await chrome.storage.sync.get('prefix');
  if (!MosaicCore.matches(location.href, prefix)) return;
  const hello = () => chrome.runtime.sendMessage({ type: 'hello' }).catch(() => ({}));
  const reply = await hello();
  if (reply?.version) document.documentElement.dataset.mosaicBrowser = reply.version;
  // The worker only sees framed responses while it is awake; keep it awake while this page is open.
  setInterval(hello, 20000);
})();
