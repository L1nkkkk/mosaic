import { field, fields, text } from '../web/ui.js';
const local = /^api\/media\/[a-f0-9]{64}\.(webp|mp3|wav|ogg|flac)$/;
export function mediaUrl(value, kind = 'image') {
  const result = text(value, 1500, kind === 'audio' ? '音频地址' : '图片地址');
  if (!result) return '';
  if (local.test(result) && (kind === 'audio' ? !result.endsWith('.webp') : result.endsWith('.webp'))) return result;
  if (kind === 'audio') {
    try { const url = new URL(result); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch { /* Use a plain validation message. */ }
  }
  throw new Error(kind === 'audio' ? '请上传音频或填写 HTTPS 音频直链。' : '请使用上传图片功能。');
}
export function mediaField(label, value, change, kind = 'image') {
  const wrapper = fields();
  const caption = document.createElement('span'); caption.textContent = label;
  const input = document.createElement('input'); input.type = 'file'; input.setAttribute('aria-label', label);
  input.accept = kind === 'audio' ? '.mp3,.wav,.ogg,.flac' : 'image/jpeg,image/png,image/webp';
  const status = document.createElement('small'); status.setAttribute('role', 'status');
  status.textContent = value ? '已选择素材' : kind === 'audio' ? '上传音频，最大 20 MB' : '上传图片，自动压缩';
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '清除素材'; remove.hidden = !value;
  remove.onclick = () => { change(''); status.textContent = '已清除，请保存草稿'; remove.hidden = true; };
  input.onchange = async () => {
    const file = input.files[0]; if (!file) return;
    input.disabled = true; status.textContent = '正在处理并上传…';
    try {
      let bytes = file, type;
      if (kind === 'image') { const { compressBackground } = await import('../web/appearance.js'); bytes = await compressBackground(file); type = 'image/webp'; }
      else {
        if (file.size > 20 * 1024 * 1024) throw new Error('音频最大 20 MB。');
        type = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' }[file.name.split('.').at(-1).toLowerCase()];
        if (!type) throw new Error('请选择 MP3、WAV、OGG 或 FLAC。');
      }
      const response = await fetch(new URL('api/admin/media', document.baseURI), { method: 'POST', headers: { 'Content-Type': type }, body: bytes });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '上传失败。');
      change(result.url); status.textContent = '上传完成，请保存草稿。未保存素材保留 24 小时。'; remove.hidden = false;
    } catch (error) { status.textContent = error.message; }
    finally { input.disabled = false; input.value = ''; }
  };
  wrapper.className = 'module-fields media-editor'; wrapper.append(caption, input, status, remove);
  if (kind === 'audio') wrapper.append(field('或填写 HTTPS 音频直链', value?.startsWith('https:') ? value : '', change, { maxLength: 1500, placeholder: 'https://…/music.mp3' }));
  return wrapper;
}
export function imageElement(image, url, alt = '') {
  image.alt = alt; image.loading = 'lazy'; image.decoding = 'async';
  if (image.dataset.url === url) return;
  image.dataset.url = url; image.hidden = !url;
  if (url) image.src = new URL(url, document.baseURI); else image.removeAttribute('src');
}
