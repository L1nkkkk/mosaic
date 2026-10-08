import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
const display = (value, unit = '') => typeof value === 'number' ? `${Math.round(value)}${unit}` : '—';
function condition(code, isDay = true) {
  if (code === 0) return [isDay ? '☀' : '☾', '晴'];
  if ([1, 2, 3].includes(code)) return ['☁', '多云'];
  if ([45, 48].includes(code)) return ['≋', '雾'];
  if ([51, 53, 55, 56, 57].includes(code)) return ['☂', '小雨'];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['☂', '雨'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['❄', '雪'];
  if ([95, 96, 99].includes(code)) return ['ϟ', '雷雨'];
  return ['◇', '天气待更新'];
}
export async function load({ request, data }) {
  if (!data.city) return { configured: false };
  const value = await request(`weather?${new URLSearchParams({ latitude: data.city.latitude, longitude: data.city.longitude })}`);
  return { ...value, cityKey: `${data.city.latitude},${data.city.longitude}` };
}
export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const update = patch => { data = { ...data, ...patch }; change(data); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
  const form = document.createElement('div'); form.className = 'weather-search';
  const input = document.createElement('input'); input.placeholder = '例如：深圳、北京、London'; input.setAttribute('aria-label', '搜索城市'); input.maxLength = 80;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'button outline'; button.textContent = '搜索城市';
  const status = document.createElement('small'); status.setAttribute('role', 'status'); status.textContent = data.city ? `已选：${data.city.name} · ${data.city.region}` : '选择一个城市，不使用访客定位。';
  const results = document.createElement('div'); results.className = 'weather-city-results';
  button.onclick = async () => {
    button.disabled = true; status.textContent = '正在搜索…'; results.replaceChildren();
    try {
      const response = await fetch(new URL(`api/admin/cities?${new URLSearchParams({ name: input.value.trim() })}`, document.baseURI));
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      for (const city of value.cities) {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'button subtle'; item.textContent = `${city.name} · ${city.region}`;
        item.onclick = () => { update({ city }); status.textContent = `已选：${city.name} · ${city.region}，保存后自动读取天气。`; results.replaceChildren(); };
        results.append(item);
      }
      status.textContent = value.cities.length ? '选择城市后保存草稿即可生效。' : '没有找到，请换个名称或加上省份。';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); button.click(); } };
  form.append(input, button, status, results); wrapper.append(form); return wrapper;
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'weather-module';
  card.innerHTML = '<header><h2></h2><span class="weather-city"></span></header><div class="weather-current"><span class="weather-icon" aria-hidden="true"></span><strong></strong></div><p class="weather-condition"></p><p class="weather-details"></p><div class="weather-forecast"></div><p class="weather-status" role="status"></p><a class="weather-source" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather by Open-Meteo</a>';
  context.root.append(card);
  return { update(data, resource) {
    const value = resource?.value, key = data.city && `${data.city.latitude},${data.city.longitude}`;
    const ready = value?.available && value.cityKey === key;
    card.querySelector('h2').textContent = data.title;
    card.querySelector('.weather-city').textContent = data.city?.name || '尚未选择城市';
    const [symbol, label] = condition(ready ? value.code : null, value?.isDay);
    card.querySelector('.weather-icon').textContent = symbol; card.querySelector('strong').textContent = ready ? display(value.temperature, '°') : '—';
    card.querySelector('.weather-condition').textContent = ready ? label : '';
    card.querySelector('.weather-details').textContent = ready ? `体感 ${display(value.feelsLike, '°')} · 湿度 ${display(value.humidity, '%')} · 风速 ${display(value.wind, ' km/h')}` : '';
    const forecast = card.querySelector('.weather-forecast'); forecast.replaceChildren();
    if (ready) value.forecast.forEach((day, i) => { const row = document.createElement('div'); const name = document.createElement('span'), icon = document.createElement('b'), temp = document.createElement('small'); name.textContent = ['今天', '明天', '后天'][i]; icon.textContent = condition(day.code)[0]; temp.textContent = `${display(day.low)} / ${display(day.high)}°`; row.append(name, icon, temp); forecast.append(row); });
    card.querySelector('.weather-status').textContent = !data.city ? '在编辑台选择城市，显示实时天气。' : resource?.error ? '天气暂时不可用，稍后自动重试。' : ready ? `更新于 ${value.time.replace('T', ' ')} · 当地时间` : '正在等待天气更新…';
  } };
}
