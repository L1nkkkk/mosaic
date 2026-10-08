import { mkdir, readdir, stat, open, rename, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateBackground } from './appearance.js';

const pattern = /^[a-f0-9]{64}\.(webp|mp3|wav|ogg|flac)$/;
const formats = { 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac' };
const mime = Object.fromEntries(Object.entries(formats).map(([type, extension]) => [extension, type]));
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export function mediaReferences(value, found = new Set()) {
  if (typeof value === 'string' && value.startsWith('api/media/') && pattern.test(value.slice(10))) found.add(value.slice(10));
  else if (Array.isArray(value)) value.forEach(item => mediaReferences(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => mediaReferences(item, found));
  return found;
}

export class MediaStore {
  constructor(directory) { this.directory = path.join(directory, 'media'); this.queue = Promise.resolve(); }
  save(bytes, type, references) {
    const extension = formats[type];
    if (!extension) throw error('请选择 WebP 图片或 MP3、WAV、OGG、FLAC 音频。', 415);
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw error('音频最大 20 MB，图片会自动压缩。', 413);
    if (extension === 'webp') validateBackground(bytes);
    else {
      const valid = extension === 'mp3' ? bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224
        : extension === 'wav' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
        : extension === 'ogg' ? bytes.toString('ascii', 0, 4) === 'OggS' : bytes.toString('ascii', 0, 4) === 'fLaC';
      if (!valid || bytes.length < 16) throw error('音频文件格式不正确。');
    }
    const operation = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
      let total = 0, exists = false;
      for (const file of await readdir(this.directory)) {
        if (!pattern.test(file)) continue;
        const info = await stat(path.join(this.directory, file));
        if (!references.has(file) && Date.now() - info.mtimeMs > 86400000 && file !== name) await unlink(path.join(this.directory, file));
        else { total += info.size; if (file === name) exists = true; }
      }
      if (!exists) {
        if (total + bytes.length > 96 * 1024 * 1024) throw error('素材空间已满（96 MB）。请移除不用的素材并保存，清理后再上传。', 413);
        const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
        try {
          const handle = await open(temporary, 'wx', 0o600);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
          await rename(temporary, path.join(this.directory, name));
        } finally { await unlink(temporary).catch(() => {}); }
      }
      return { url: `api/media/${name}`, bytes: bytes.length, type };
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async serve(name, request, response) {
    if (!pattern.test(name)) return false;
    let info;
    const filename = path.join(this.directory, name);
    try { info = await stat(filename); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    const headers = { 'Content-Type': mime[name.split('.').at(-1)], 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    let start = 0, end = info.size - 1, status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || !match[1] && !match[2]) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return true; }
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return true; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    response.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
    if (request.method === 'HEAD') response.end();
    else { const stream = createReadStream(filename, { start, end }); stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); }
    return true;
  }
}
