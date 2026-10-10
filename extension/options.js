const form = document.querySelector('form'), input = form.elements.prefix, status = document.querySelector('[role="status"]');
chrome.storage.sync.get('prefix').then(({ prefix }) => { input.value = prefix || ''; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const mosaic = MosaicCore.parsePrefix(input.value);
  if (!mosaic) { status.textContent = '请输入以 https:// 或 http:// 开头的完整地址。'; return; }
  input.value = mosaic.origin + mosaic.path;
  await chrome.storage.sync.set({ prefix: input.value });
  status.textContent = '已保存，刷新 Mosaic 页面后生效。';
});
