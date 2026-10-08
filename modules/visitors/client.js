import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
export async function load({ request }) { return request('visitors'); }
export function edit({ data, change }) {
  const wrapper = fields(field('标题', data.title, title => change({ title }), { maxLength: 100 }));
  const note = document.createElement('p'); note.className = 'muted'; note.textContent = '公开发布本模块后开始统计公开页访问；主人已登录的访问不计入。地区由 IP 粗略查询，不代表精确位置；不保存原始 IP，尊重浏览器的禁止追踪设置。'; wrapper.append(note); return wrapper;
}
const regions = { CN: [400, 72], HK: [411, 94], TW: [425, 92], JP: [449, 70], KR: [432, 70], SG: [403, 132], IN: [365, 108], US: [104, 82], CA: [110, 48], GB: [249, 52], DE: [269, 56], FR: [260, 65], NL: [265, 52], AU: [446, 172], NZ: [481, 195], RU: [369, 38], BR: [162, 157], ZA: [280, 183], ID: [413, 145], MY: [402, 126], TH: [394, 110], VN: [407, 112], PH: [437, 115], IT: [278, 75], ES: [248, 78], MX: [103, 112], AR: [156, 197] };
const names = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
export function mount(context) {
  const card = document.createElement('article'); card.className = 'visitors-module';
  card.innerHTML = `<h2></h2><svg class="visitors-map" viewBox="0 0 520 240" role="img" aria-label="访客国家和地区示意图"><g class="visitors-land"><path d="M35 42 80 20 142 27 177 53 151 85 128 88 107 118 86 102 72 77 44 70Z M133 118 168 130 183 160 168 193 151 220 139 192 125 154Z M216 39 243 22 261 34 268 50 251 64 234 58Z M249 78 285 71 314 92 305 133 283 181 263 190 245 153 228 119Z M270 43 325 20 396 23 446 42 472 69 449 84 417 77 401 112 379 135 356 101 335 95 318 72 288 77Z M405 148 438 139 461 162 455 192 423 195 404 174Z M479 186 490 197 481 216 472 210Z M189 15 218 9 233 27 220 45 198 43Z"/></g><g class="visitors-points"></g></svg><div class="visitors-numbers"><div><span>今日访客 · 估算</span><strong data-number="today">0</strong></div><div><span>累计访问</span><strong data-number="total">0</strong></div></div><ul class="visitors-regions"></ul><p class="visitors-message" role="status"></p><details class="visitors-privacy"><summary>统计说明</summary><p>仅统计公开页，30 秒内重复访问去重。访客数按每日地址与浏览器特征估算，不保存原始 IP。地区查询由 ipwho.is 提供，仅作国家/地区参考；不使用定位权限或追踪 Cookie，遵循 DNT / GPC。地区分布展示最近 30 天。</p></details>`;
  context.root.append(card);
  return { update(data, resource) {
    card.querySelector('h2').textContent = data.title;
    const value = resource?.value;
    card.querySelector('[data-number="today"]').textContent = value?.today?.visitors?.toLocaleString() || '0'; card.querySelector('[data-number="total"]').textContent = value?.totalViews?.toLocaleString() || '0';
    const list = card.querySelector('ul'), markers = card.querySelector('.visitors-points'); list.replaceChildren(); markers.replaceChildren();
    for (const row of value?.regions || []) {
      const name = row.code === 'ZZ' ? '未知地区' : names.of(row.code) || row.code;
      if (list.children.length < 5) { const li = document.createElement('li'); const label = document.createElement('span'), count = document.createElement('strong'); label.textContent = name; count.textContent = row.visitors.toLocaleString(); li.append(label, count); list.append(li); }
      if (regions[row.code]) { const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('cx', regions[row.code][0]); dot.setAttribute('cy', regions[row.code][1]); dot.setAttribute('r', Math.min(8, 2 + Math.log2(row.visitors + 1))); const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = `${name} · ${row.visitors}`; dot.append(title); markers.append(dot); }
    }
    card.querySelector('.visitors-message').textContent = resource?.error ? '统计暂时不可用，稍后重试。' : !value?.enabled ? '公开发布本模块后开始统计，当前不采集访客。' : !value?.started ? '等待第一位访客；不会生成示例访问数据。' : `自 ${value.started} 起统计 · 地区示意，非精确位置`;
  } };
}
