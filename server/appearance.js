import { mkdir, readFile, open, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ConflictError } from './store.js';

const imageName = /^[a-f0-9]{64}\.webp$/;
const invalid = message => Object.assign(new Error(message), { status: 400 });
export const MAX_BACKGROUND_BYTES = 512 * 1024;

// Accept only bounded, static WebP files produced by the browser uploader.
export function validateBackground(bytes) {
  if (bytes.length > MAX_BACKGROUND_BYTES) throw Object.assign(new Error('图片压缩后仍过大，请换一张图片。'), { status: 413 });
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid('图片格式不正确，请重新选择图片。');
  let width, height, hasImage = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw invalid('图片数据不完整。');
    const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) throw invalid('图片数据不完整。');
    if (type === 'ANIM' || type === 'ANMF') throw invalid('请选择静态图片。');
    if (type === 'VP8X') {
      if (length !== 10 || bytes[start] & 2) throw invalid('请选择静态图片。');
      width = bytes.readUIntLE(start + 4, 3) + 1; height = bytes.readUIntLE(start + 7, 3) + 1;
    } else if (type === 'VP8 ') {
      if (length < 10 || bytes.subarray(start + 3, start + 6).toString('hex') !== '9d012a') throw invalid('图片格式不正确。');
      const w = bytes.readUInt16LE(start + 6) & 0x3fff, h = bytes.readUInt16LE(start + 8) & 0x3fff;
      if (width && (width !== w || height !== h)) throw invalid('图片尺寸不一致。');
      width = w; height = h; hasImage = true;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[start] !== 0x2f) throw invalid('图片格式不正确。');
      const bits = bytes.readUInt32LE(start + 1), w = (bits & 0x3fff) + 1, h = ((bits >>> 14) & 0x3fff) + 1;
      if (width && (width !== w || height !== h)) throw invalid('图片尺寸不一致。');
      width = w; height = h; hasImage = true;
    }
    offset = start + length + (length % 2);
    if (offset > bytes.length) throw invalid('图片数据不完整。');
  }
  if (!hasImage || !width || !height || width > 3840 || height > 3840 || width * height > 8_000_000) throw invalid('图片尺寸不支持，请重新选择图片。');
}

export class AppearanceStore {
  constructor(directory) {
    this.directory = directory;
    this.filename = path.join(directory, 'appearance.json');
    this.images = path.join(directory, 'backgrounds');
    this.queue = Promise.resolve();
  }
  async read() {
    let state;
    try { state = JSON.parse(await readFile(this.filename, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { revision: 0, background: 'default' }; throw error; }
    if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !['default', 'none'].includes(state.background) && !imageName.test(state.background)) throw new Error('Invalid saved appearance; original file preserved');
    return { revision: state.revision, background: state.background };
  }
  publicState(state) {
    return { ...state, backgroundUrl: state.background === 'none' ? null : state.background === 'default' ? 'web/assets/alpine-dusk.jpg' : `api/background/${state.background}` };
  }
  async initialize() {
    const state = await this.read();
    if (imageName.test(state.background)) validateBackground(await readFile(path.join(this.images, state.background)));
  }
  async image(name) {
    if (!imageName.test(name)) return null;
    try { return await readFile(path.join(this.images, name)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  save(revision, background, bytes) {
    if (bytes) { validateBackground(bytes); background = `${createHash('sha256').update(bytes).digest('hex')}.webp`; }
    else if (!['default', 'none'].includes(background)) throw invalid('请选择默认背景或纯色背景。');
    const operation = this.queue.then(async () => {
      const current = await this.read();
      if (revision !== current.revision) throw new ConflictError('背景已在其他窗口更新，请重新选择。');
      await mkdir(this.images, { recursive: true, mode: 0o700 });
      // Write image first; appearance never points at a partially written file.
      if (bytes) await this.atomicWrite(path.join(this.images, background), bytes);
      const next = { revision: current.revision + 1, background };
      await this.atomicWrite(this.filename, JSON.stringify(next) + '\n');
      // Retain the previous image for in-flight readers; disk use stays bounded.
      for (const name of await readdir(this.images)) {
        if (imageName.test(name) && name !== background && name !== current.background) await unlink(path.join(this.images, name)).catch(() => {});
      }
      return this.publicState(next);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async atomicWrite(filename, data) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, filename);
      const directory = await open(path.dirname(filename), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}
