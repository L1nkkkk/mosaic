import { createHash, createHmac, randomInt } from 'node:crypto';

const md5 = value => createHash('md5').update(value).digest('hex');
export const gameNames = { genshin: '原神', arknights: '明日方舟', endfield: '终末地' };
const str = value => typeof value === 'string' ? value.slice(0, 100) : '';
const num = value => (typeof value === 'number' || typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const time = value => { const n = num(value); return n && n < 1e11 ? n * 1000 : null; };
const count = (label, current, max) => ({ label, current: num(current), max: num(max) });
const choose = list => list?.find(item => item.isDefault || item.is_chosen) || list?.[0];
export class GameError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; this.status = 400; }
}
export function sklandHeaders(cred, token, url, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000) - 1);
  const signed = { platform: '', timestamp, dId: '', vName: '' };
  const target = new URL(url);
  const digest = createHmac('sha256', token).update(target.pathname + target.search.slice(1) + timestamp + JSON.stringify(signed)).digest('hex');
  return { ...signed, cred, sign: md5(digest), 'User-Agent': 'Skland/1.32.1 (com.hypergryph.skland; build:103201004; Android 33; ) Okhttp/4.11.0' };
}
export function normalizeGame(game, data, role, now) {
  let energy, metrics, nickname = role.nickname, level = role.level;
  if (game === 'genshin') {
    energy = { ...count('原粹树脂', data.current_resin, data.max_resin), fullAt: num(data.resin_recovery_time) === null ? null : now + num(data.resin_recovery_time) * 1000 };
    metrics = [count('每日委托', data.finished_task_num, data.total_task_num), count('洞天宝钱', data.current_home_coin, data.max_home_coin), count('派遣完成', Array.isArray(data.expeditions) ? data.expeditions.filter(item => item.status === 'Finished').length : null, data.current_expedition_num)];
    if (typeof data.is_extra_task_reward_received === 'boolean') metrics.push({ label: '委托奖励', text: data.is_extra_task_reward_received ? '已领取' : '未领取' });
  } else if (game === 'arknights') {
    const s = data.status || {}, ap = s.ap || {};
    nickname = str(s.name) || nickname; level = num(s.level);
    energy = { ...count('理智', ap.current, ap.max), fullAt: time(ap.completeRecoveryTime) };
    metrics = [count('每日任务', data.routine?.daily?.current, data.routine?.daily?.total), count('每周任务', data.routine?.weekly?.current, data.routine?.weekly?.total), count('公开招募刷新', data.building?.hire?.refreshCount, 3)];
  } else {
    const d = data.dungeon || {};
    nickname = str(data.base?.name) || nickname; level = num(data.base?.level);
    energy = { ...count('体力', d.curStamina, d.maxStamina), fullAt: time(d.maxTs) };
    metrics = [count('每日活跃度', data.dailyMission?.dailyActivation, data.dailyMission?.maxDailyActivation), count('每周任务', data.weeklyMission?.score, data.weeklyMission?.total)];
  }
  if (energy.current === null || energy.max === null || energy.max <= 0) throw new GameError('unavailable', '游戏数据不完整，请确认已开启社区数据展示。');
  return { game, name: gameNames[game], nickname: str(nickname), level: num(level), uid: str(role.uid), server: str(role.server), energy, metrics, updatedAt: now };
}

export function gameProviders(fetcher = fetch, clock = Date.now) {
  async function json(url, headers = {}) {
    let response;
    try {
      response = await fetcher(url, { headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new GameError([401,403].includes(response.status) ? 'auth' : 'unavailable', '游戏服务暂时无法访问，请稍后重试或更新绑定。');
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error(); chunks.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      const value = JSON.parse(Buffer.concat(chunks).toString());
      const code = value.retcode ?? value.code ?? value.status;
      if (code !== 0) {
        if ([-100,10001,10000,10002].includes(code)) throw new GameError('auth', '登录凭据已失效，请重新绑定。');
        if (code === 5003 && new URL(url).hostname === 'api-takumi-record.mihoyo.com') throw new GameError('restricted', '米游社提示当前账号存在风险，暂不提供战绩数据（5003）。自动重试已暂停；可稍后手动刷新，持续受限时请向米游社客服反馈。');
        if ([1034,10035,10041].includes(code)) throw new GameError('verification', '社区要求额外安全验证，请先在官方 App 打开游戏数据页面并完成提示的验证，再返回刷新；仍失败时重新扫码绑定。');
        throw new GameError('unavailable', '社区未返回可用数据，请检查数据展示设置或稍后重试。');
      }
      if (!value.data || typeof value.data !== 'object') throw new Error();
      return value.data;
    } catch (error) { if (error instanceof GameError) throw error; throw new GameError('unavailable', '游戏服务暂时不可用，稍后重试。'); }
  }
  async function discover(provider, credential) {
    if (provider === 'miyoushe') {
      const data = await json('https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn', { Cookie: credential });
      const role = choose(data.list?.filter(item => ['cn_gf01', 'cn_qd01'].includes(item.region)));
      if (!role) throw new GameError('unavailable', '没有找到国服原神角色。');
      return { roles: { genshin: { uid: str(role.game_uid), region: str(role.region), nickname: str(role.nickname), level: num(role.level), server: str(role.region_name) } } };
    }
    const refreshed = await json('https://zonai.skland.com/api/v1/auth/refresh', { cred: credential });
    if (typeof refreshed.token !== 'string' || !refreshed.token) throw new GameError('auth', '森空岛凭据失效，请重新绑定。');
    const signed = url => json(url, sklandHeaders(credential, refreshed.token, url, clock()));
    const binding = await signed('https://zonai.skland.com/api/v1/game/player/binding');
    const roles = {};
    for (const game of ['arknights', 'endfield']) {
      const app = binding.list?.find(item => item.appCode === game);
      const candidates = app?.bindingList?.filter(item => !item.isDelete) || [];
      const parent = choose(candidates);
      if (!parent) continue;
      if (game === 'arknights') roles[game] = { uid: str(parent.uid), nickname: str(parent.nickName), server: str(parent.channelName) };
      else {
        const role = choose(parent.roles?.filter(item => !item.isBanned));
        if (role) roles[game] = { uid: str(role.roleId), serverId: str(role.serverId), nickname: str(role.nickname), level: num(role.level), server: str(role.serverName) };
      }
    }
    if (!Object.keys(roles).length) throw new GameError('unavailable', '森空岛未绑定明日方舟或终末地角色。');
    if (roles.endfield) {
      const user = await signed('https://zonai.skland.com/api/v1/user/teenager');
      const userId = user.teenager?.userId;
      if (typeof userId !== 'string' || !userId) throw new GameError('unavailable', '无法读取森空岛账号身份。');
      roles.endfield.userId = userId;
    }
    return { roles, token: refreshed.token };
  }
  async function read(game, credential, session) {
    const role = session.roles[game]; let data;
    if (game === 'genshin') {
      const query = new URLSearchParams({ role_id: role.uid, server: role.region }).toString();
      const t = Math.floor(clock() / 1000), r = randomInt(100001, 200001);
      const ds = `${t},${r},${md5(`salt=xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs&t=${t}&r=${r}&b=&q=${query}`)}`;
      data = await json('https://api-takumi-record.mihoyo.com/game_record/app/genshin/api/dailyNote?' + query, { Cookie: credential, DS: ds, 'x-rpc-app_version': '2.11.1', 'x-rpc-client_type': '5', Referer: 'https://webstatic.mihoyo.com/' });
    } else {
      const url = game === 'arknights' ? 'https://zonai.skland.com/api/v1/game/player/info?' + new URLSearchParams({ uid: role.uid }) : 'https://zonai.skland.com/web/v1/game/endfield/card/detail?' + new URLSearchParams({ roleId: role.uid, serverId: role.serverId, userId: role.userId });
      data = await json(url, sklandHeaders(credential, session.token, url, clock()));
      if (game === 'endfield') data = data.detail;
    }
    if (!data) throw new GameError('unavailable', '游戏数据暂不可用。');
    return normalizeGame(game, data, role, clock());
  }
  return { discover, read };
}
