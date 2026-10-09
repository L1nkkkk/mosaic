import { createHash, randomUUID } from 'node:crypto';
import { GameError } from './game-providers.js';

const passport = 'https://passport-api.miyoushe.com/account/ma-cn-passport/web/';
const hypergryph = 'https://as.hypergryph.com/';
const appCode = '4ca99fa6b56cc2ba';
const cookieNames = new Set(['cookie_token_v2', 'account_mid_v2', 'account_id_v2', 'ltoken_v2', 'ltmid_v2', 'ltuid_v2']);
const unavailable = () => new GameError('unavailable', '扫码服务暂不可用，请稍后重新生成二维码。');
function string(value) { if (typeof value !== 'string' || !value || value.length > 12000 || /[\x00-\x1f]/.test(value)) throw unavailable(); return value; }

// All upstream destinations are fixed; tickets and credentials never enter logs or page data.
export class GameQr {
  constructor(games, fetcher = fetch, clock = Date.now) {
    this.games = games; this.fetch = fetcher; this.clock = clock;
    this.flows = new Map(); this.lastStart = new Map(); this.queue = Promise.resolve();
  }
  serial(fn) { const work = this.queue.then(fn); this.queue = work.catch(() => {}); return work; }
  owner(cookie) { return createHash('sha256').update(cookie || '').digest('hex'); }
  async request(url, data, headers = {}) {
    try {
      const response = await this.fetch(url, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw unavailable();
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > 128 * 1024) throw unavailable(); chunks.push(chunk); }
      const result = JSON.parse(Buffer.concat(chunks).toString());
      return { result, cookies: response.headers.getSetCookie() };
    } catch { throw unavailable(); }
  }
  async ok(url, data, headers) {
    const reply = await this.request(url, data, headers);
    if ((reply.result.retcode ?? reply.result.status ?? reply.result.code) !== 0) throw unavailable();
    return { ...reply, data: reply.result.data };
  }
  view(flow, includeQr = false) {
    return { id: flow.id, provider: flow.provider, state: flow.state, expiresAt: flow.expiresAt, ...(includeQr ? { qr: flow.qr } : {}), ...(flow.message ? { message: flow.message } : {}) };
  }
  start(provider, owner) {
    return this.serial(async () => {
      if (!['miyoushe', 'skland'].includes(provider)) throw new GameError('input', '请选择米游社或森空岛。');
      const now = this.clock();
      if (now - (this.lastStart.get(provider) ?? -Infinity) < 10000) throw new GameError('input', '请等待 10 秒后再生成二维码。');
      this.lastStart.set(provider, now);
      for (const [id, flow] of this.flows) if (flow.provider === provider || flow.expiresAt <= now) this.flows.delete(id);
      const flow = { id: randomUUID(), provider, owner, state: 'waiting', expiresAt: now + 100000, nextPoll: 0 };
      if (provider === 'miyoushe') {
        flow.headers = { 'x-rpc-app_id': 'bll8iq97cem8', 'x-rpc-client_type': '4', 'x-rpc-game_biz': 'bbs_cn', 'x-rpc-device_fp': '38d7fa104e5d7', 'x-rpc-device_id': randomUUID() };
        const { data } = await this.ok(passport + 'createQRLogin', {}, flow.headers);
        flow.ticket = string(data?.ticket); flow.qr = string(data?.url);
        const url = new URL(flow.qr);
        if (url.protocol !== 'https:' || !['mihoyo.com', 'miyoushe.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) throw unavailable();
      } else {
        const { data } = await this.ok(hypergryph + 'general/v1/gen_scan/login', { appCode });
        flow.ticket = string(data?.scanId); flow.qr = 'hypergryph://scan_login?scanId=' + encodeURIComponent(flow.ticket);
      }
      this.flows.set(flow.id, flow); return this.view(flow, true);
    });
  }
  status(id, owner) {
    return this.serial(async () => {
      const flow = this.flows.get(id);
      if (!flow || flow.owner !== owner) throw new GameError('input', '二维码已失效，请重新生成。');
      if (!['waiting', 'scanned'].includes(flow.state)) return this.view(flow);
      if (this.clock() >= flow.expiresAt) { flow.state = 'expired'; return this.view(flow); }
      if (this.clock() < flow.nextPoll) return this.view(flow);
      flow.nextPoll = this.clock() + 2500;
      try {
        let credential;
        if (flow.provider === 'miyoushe') {
          const { data, cookies } = await this.ok(passport + 'queryQRLoginStatus', { ticket: flow.ticket }, flow.headers);
          if (data?.status === 'Created') return this.view(flow);
          if (data?.status === 'Scanned') { flow.state = 'scanned'; return this.view(flow); }
          if (data?.status !== 'Confirmed') throw unavailable();
          const selected = cookies.map(cookie => cookie.split(';')[0]).filter(cookie => cookieNames.has(cookie.split('=')[0]));
          if (!selected.some(cookie => cookie.startsWith('cookie_token_v2='))) throw unavailable();
          credential = selected.join('; ');
        } else {
          const { result } = await this.request(hypergryph + 'general/v1/scan_status?scanId=' + encodeURIComponent(flow.ticket));
          if (result.status === 100) return this.view(flow);
          if (result.status === 101) { flow.state = 'scanned'; return this.view(flow); }
          if (result.status === 102) { flow.state = 'expired'; return this.view(flow); }
          if (result.status !== 0) throw unavailable();
          const scanCode = string(result.data?.scanCode);
          const token = string((await this.ok(hypergryph + 'user/auth/v1/token_by_scan_code', { scanCode })).data?.token);
          const code = string((await this.ok(hypergryph + 'user/oauth2/v2/grant', { appCode, token, type: 0 })).data?.code);
          credential = string((await this.ok('https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code', { code, kind: 1 })).data?.cred);
        }
        if (this.clock() >= flow.expiresAt) { flow.state = 'expired'; return this.view(flow); }
        await this.games.configure({ provider: flow.provider, credential });
        flow.state = 'bound'; delete flow.ticket; delete flow.qr; delete flow.headers;
      } catch (error) {
        flow.state = 'error'; flow.message = error instanceof GameError ? error.message : '绑定失败，请重新扫码。';
        delete flow.ticket; delete flow.qr; delete flow.headers;
      }
      return this.view(flow);
    });
  }
  cancel(id, owner) { return this.serial(() => { const flow = this.flows.get(id); if (flow?.owner === owner) this.flows.delete(id); return { ok: true }; }); }
  configure(payload) {
    return this.serial(async () => {
      for (const [id, flow] of this.flows) if (flow.provider === payload.provider) this.flows.delete(id);
      return this.games.configure(payload);
    });
  }
}
