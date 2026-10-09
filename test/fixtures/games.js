export function gameFetchFixture() {
  const state = { calls: [], fail: null };
  state.fetch = async (url, options) => {
    url = String(url); state.calls.push({ url, headers: options.headers });
    if (state.fail === 'all') throw new Error('DO-NOT-LEAK-CREDENTIAL');
    if (url.includes('getUserGameRolesByCookie')) return Response.json({ retcode: 0, data: { list: [{ game_uid: '123456789', region: 'cn_gf01', nickname: '旅行者<script>', level: 60, region_name: '天空岛' }] } });
    if (url.includes('dailyNote')) return Response.json(state.fail === 'genshin' ? { retcode: 1034 } : { retcode: 0, data: { current_resin: 150, max_resin: 200, resin_recovery_time: 24000, finished_task_num: 3, total_task_num: 4, current_home_coin: 1200, max_home_coin: 2400, expeditions: [{ status: 'Finished' }], current_expedition_num: 5, is_extra_task_reward_received: false, secret: 'SHOULD-NOT-PASS' } });
    if (url.endsWith('/auth/refresh')) return Response.json({ code: 0, data: { token: 'test-signing-token' } });
    if (url.endsWith('/player/binding')) return Response.json({ code: 0, data: { list: [{ appCode: 'arknights', bindingList: [{ uid: 'ark-uid', nickName: '博士', channelName: '官服' }] }, { appCode: 'endfield', bindingList: [{ uid: 'not-the-player-id', roles: [{ roleId: 'ef-role', serverId: '1', nickname: '管理员', level: 30, serverName: 'China' }] }] }] } });
    if (url.endsWith('/user/teenager')) return Response.json({ code: 0, data: { teenager: { userId: 'skland-account-id' } } });
    if (url.includes('/player/info')) return Response.json({ code: 0, data: { status: { name: '博士', level: 120, ap: { current: 120, max: 135, completeRecoveryTime: Math.floor(Date.now() / 1000) + 5400 } }, routine: { daily: { current: 80, total: 100 }, weekly: { current: 300, total: 500 } }, building: { hire: { refreshCount: 2 } } } });
    if (url.includes('/endfield/card/detail')) return Response.json({ code: 0, data: { detail: { base: { name: '管理员', level: 30 }, dungeon: { curStamina: '200', maxStamina: '240', maxTs: String(Math.floor(Date.now() / 1000) + 14400) }, dailyMission: { dailyActivation: 60, maxDailyActivation: 100 }, weeklyMission: { score: 2, total: 10 } } } });
    throw new Error('unexpected URL');
  };
  return state;
}
