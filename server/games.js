import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { gameProviders, gameNames, GameError } from './game-providers.js';

const groups = { miyoushe: ['genshin'], skland: ['arknights', 'endfield'] };
// The vault is outside page content and cannot be served by the static routes.
export class Games {
  constructor(directory, secret, fetcher, clock = Date.now) {
    this.file = path.join(directory, 'game-accounts.enc'); this.directory = directory;
    this.key = createHash('sha256').update('mosaic-game-accounts-v1\0' + secret).digest();
    this.provider = gameProviders(fetcher, clock); this.clock = clock;
    this.accounts = {}; this.results = {}; this.nextAt = 0; this.lastAttempt = -Infinity; this.queue = Promise.resolve();
  }
  async initialize() {
    let raw;
    try { raw = await readFile(this.file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    try {
      const value = JSON.parse(raw), decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      this.accounts = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString());
    } catch { throw new Error('游戏账号文件无法解密，请恢复原 SESSION_SECRET 或备份文件。'); }
  }
  serial(fn) { const work = this.queue.then(fn); this.queue = work.catch(() => {}); return work; }
  async persist(accounts) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(accounts)), cipher.final()]);
    await mkdir(this.directory, { recursive: true });
    const temporary = this.file + '.tmp';
    await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  configure(payload) {
    return this.serial(async () => {
      const { provider, credential, disconnect } = payload;
      if (!Object.hasOwn(groups, provider)) throw new GameError('input', '请选择米游社或森空岛。');
      const next = { ...this.accounts };
      if (disconnect === true) delete next[provider];
      else {
        if (typeof credential !== 'string' || credential.trim().length < 8 || credential.length > 12000 || /[\r\n\x00-\x1f]/.test(credential)) throw new GameError('input', '请填写有效的账号凭据。');
        // Validate the binding before replacing a working credential.
        await this.provider.discover(provider, credential.trim());
        next[provider] = credential.trim();
      }
      await this.persist(next); this.accounts = next;
      for (const game of groups[provider]) delete this.results[game];
      this.nextAt = 0; this.lastAttempt = -Infinity;
      return { ok: true };
    });
  }
  snapshot() {
    const now = this.clock();
    return { accounts: { miyoushe: !!this.accounts.miyoushe, skland: !!this.accounts.skland }, refreshAfter: Math.max(this.nextAt, this.lastAttempt + 60000), games: Object.entries(gameNames).map(([game, name]) => {
      const bound = !!this.accounts[game === 'genshin' ? 'miyoushe' : 'skland'];
      const result = this.results[game] || {};
      return { game, name, ...result, state: bound ? result.state || 'waiting' : 'unbound', stale: !!result.updatedAt && (result.state !== 'ready' || now - result.updatedAt > 10 * 60000) };
    }) };
  }
  read(force = false) {
    return this.serial(async () => {
      const now = this.clock();
      if (now < this.nextAt && !force || now - this.lastAttempt < 60000) return this.snapshot();
      this.lastAttempt = now; let failed = false;
      const fail = (game, error) => {
        failed = true;
        this.results[game] = { ...this.results[game], state: error instanceof GameError ? error.kind : 'unavailable', message: error instanceof GameError ? error.message : '暂时无法更新，请稍后重试。' };
      };
      await Promise.all(Object.entries(groups).map(async ([provider, games]) => {
        const credential = this.accounts[provider]; if (!credential) return;
        // Account-risk responses are not CAPTCHA prompts. Wait for an explicit retry.
        if (!force && provider === 'miyoushe' && this.results.genshin?.state === 'restricted') return;
        let session;
        try { session = await this.provider.discover(provider, credential); }
        catch (error) { games.forEach(game => fail(game, error)); return; }
        await Promise.all(games.map(async game => {
          if (!session.roles[game]) { this.results[game] = { state: 'missing', message: '请先在官方社区绑定该游戏角色。' }; return; }
          try { this.results[game] = { ...await this.provider.read(game, credential, session), state: 'ready' }; }
          catch (error) { fail(game, error); }
        }));
      }));
      this.nextAt = this.clock() + (failed ? 60000 : 5 * 60000);
      return this.snapshot();
    });
  }
}
