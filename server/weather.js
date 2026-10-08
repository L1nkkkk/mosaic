import { externalJson, cachedProvider } from './external.js';
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function coordinates(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw Object.assign(new Error('请选择有效城市。'), { status: 400 });
  return [Number(latitude.toFixed(3)), Number(longitude.toFixed(3))];
}
export function weatherProvider(fetcher) {
  let day = '', hour = '', daily = 0, hourly = 0;
  function budget() {
    const now = new Date().toISOString();
    if (day !== now.slice(0, 10)) { day = now.slice(0, 10); daily = 0; }
    if (hour !== now.slice(0, 13)) { hour = now.slice(0, 13); hourly = 0; }
    if (daily >= 5000 || hourly >= 300) throw new Error('天气查询较多，请稍后重试。');
    daily++; hourly++;
  }
  const weather = cachedProvider(10 * 60000, async key => {
    budget();
    const [latitude, longitude] = key.split(',');
    const params = new URLSearchParams({ latitude, longitude, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '3' });
    const data = await externalJson(`https://api.open-meteo.com/v1/forecast?${params}`, fetcher);
    if (!data.current || !Array.isArray(data.daily?.time)) throw new Error('天气数据暂时不可用。');
    return { available: true, fetchedAt: new Date().toISOString(), time: String(data.current.time || '').slice(0, 30), timezone: String(data.timezone || 'UTC').slice(0, 80), temperature: number(data.current.temperature_2m), feelsLike: number(data.current.apparent_temperature), humidity: number(data.current.relative_humidity_2m), wind: number(data.current.wind_speed_10m), code: number(data.current.weather_code), isDay: data.current.is_day === 1,
      forecast: data.daily.time.slice(0, 3).map((day, i) => ({ day: String(day).slice(0, 10), code: number(data.daily.weather_code?.[i]), high: number(data.daily.temperature_2m_max?.[i]), low: number(data.daily.temperature_2m_min?.[i]) })) };
  });
  const search = cachedProvider(86400000, async name => {
    budget();
    const data = await externalJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: '6', language: 'zh', format: 'json' })}`, fetcher);
    return { cities: (data.results || []).slice(0, 6).filter(item => number(item.latitude) !== null && number(item.longitude) !== null).map(item => ({ name: String(item.name).slice(0, 80), region: [item.admin1, item.country].filter(Boolean).join(' · ').slice(0, 120), latitude: item.latitude, longitude: item.longitude })) };
  });
  return { weather: (lat, lon) => weather(coordinates(lat, lon).join(',')), search };
}
