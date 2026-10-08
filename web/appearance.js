async function request(route, options = {}) {
  const response = await fetch(new URL(`api/${route}`, document.baseURI), { credentials: 'same-origin', cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '暂时无法保存背景。'), { status: response.status });
  return result;
}

export async function compressBackground(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 12 * 1024 * 1024) throw new Error('原图不能超过 12 MB，请先缩小图片。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('这张图片无法读取，请换一张。'); }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('原图尺寸过大，请先缩小图片。');
    const canvas = document.createElement('canvas');
    for (const [edge, quality] of [[1920, .8], [1920, .65], [1600, .6], [1280, .5]]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob?.type === 'image/webp' && blob.size <= 512 * 1024) return blob;
    }
    throw new Error('图片无法压缩到合适大小，请换一张图片。');
  } finally { bitmap.close(); }
}

function applyAppearance(state) {
  document.documentElement.style.setProperty('--wallpaper-image', state.backgroundUrl ? `url("${new URL(state.backgroundUrl, document.baseURI).href}")` : 'none');
}

export async function openAppearance(layout, setTheme) {
  let dialog = layout.querySelector('#appearance-dialog');
  if (dialog) { dialog.showModal(); return; }
  dialog = document.createElement('dialog'); dialog.id = 'appearance-dialog';
  dialog.innerHTML = `<div class="dialog-heading"><h2>外观设置</h2><button class="icon-button" aria-label="关闭外观设置">×</button></div><fieldset><legend>明暗 · 仅这台设备</legend><label><input type="radio" name="theme" value="dark"> 深色</label><label><input type="radio" name="theme" value="light"> 浅色</label></fieldset><fieldset id="background-controls" disabled><legend>站点背景</legend><p class="appearance-help">全站同步，访客也会看到。图片会自动压缩。</p><label class="field"><span>选择图片</span><input id="background-file" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG、PNG、WebP · 原图最大 12 MB</small></label><div class="background-actions"><button class="button outline small" id="background-default">恢复默认</button><button class="button outline small" id="background-none">纯色背景</button></div></fieldset><p id="background-status" class="appearance-help" role="status">正在读取设置…</p><a id="appearance-login" href="private" hidden>登录后可修改站点背景 →</a>`;
  layout.append(dialog);
  dialog.querySelector('.dialog-heading button').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector(`[value="${document.documentElement.dataset.theme}"]`).checked = true;
  dialog.querySelectorAll('[name="theme"]').forEach(input => { input.onchange = () => setTheme(input.value); });
  dialog.showModal();
  const status = dialog.querySelector('#background-status'), controls = dialog.querySelector('#background-controls');
  let state;
  try {
    const [session, current] = await Promise.all([request('session'), request('appearance')]);
    state = current; applyAppearance(state);
    controls.hidden = !session.authenticated; controls.disabled = !session.authenticated;
    dialog.querySelector('#appearance-login').hidden = session.authenticated;
    status.textContent = session.authenticated ? '选择图片后立即保存到整个站点。' : '明暗偏好只影响这台设备。';
  } catch (error) { status.textContent = error.message; return; }
  async function save(background, file) {
    controls.disabled = true; status.textContent = file ? '正在压缩并上传…' : '正在保存…';
    try {
      state = file
        ? await request(`admin/background?revision=${state.revision}`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: await compressBackground(file) })
        : await request('admin/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, background }) });
      applyAppearance(state); status.textContent = '已保存，全站访客将看到这个背景。';
    } catch (error) {
      status.textContent = error.message;
      if (error.status === 409) { try { state = await request('appearance'); applyAppearance(state); } catch { /* Keep the failure visible; reopening retries. */ } }
      if (error.status === 401) { controls.hidden = true; dialog.querySelector('#appearance-login').hidden = false; }
    } finally { controls.disabled = false; dialog.querySelector('#background-file').value = ''; }
  }
  dialog.querySelector('#background-file').onchange = event => { const file = event.target.files[0]; if (file) void save(null, file); };
  dialog.querySelector('#background-default').onclick = () => void save('default');
  dialog.querySelector('#background-none').onclick = () => void save('none');
}
