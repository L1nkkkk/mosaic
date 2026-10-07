import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ConflictError extends Error {}

export class PageStore {
  constructor(directory, initialPage) {
    this.directory = directory;
    this.filename = path.join(directory, 'content.json');
    this.initialPage = initialPage;
    this.queue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await this.read();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const now = new Date().toISOString();
      await this.write({ schemaVersion: 1, revision: 1, draft: this.initialPage, published: this.initialPage, updatedAt: now, publishedAt: now });
    }
  }

  async read() {
    const state = JSON.parse(await readFile(this.filename, 'utf8'));
    if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !state.draft || !state.published) throw new Error('Unsupported content data; original file preserved');
    return state;
  }

  async write(state) {
    const temporary = path.join(this.directory, `.content-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, this.filename);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  mutate(expectedRevision, update) {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      if (expectedRevision !== state.revision) throw new ConflictError('内容已在其他窗口更新，请重新载入后再保存。');
      const next = update(structuredClone(state));
      next.revision = state.revision + 1;
      next.updatedAt = new Date().toISOString();
      await this.write(next);
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
