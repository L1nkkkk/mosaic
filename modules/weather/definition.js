import { text } from '../../web/ui.js';
export const meta = { id: 'weather', name: '天气', version: 1, layout: { span: 4, minWidth: 260 }, description: '当前天气、体感与三日预报，可搜索城市。', defaultData: { title: '天气', city: null } };
export function validate(data = {}) {
  let city = null;
  if (data.city !== null && data.city !== undefined) {
    const { latitude, longitude } = data.city;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('请选择有效城市。');
    city = { name: text(data.city.name, 80, '城市'), region: text(data.city.region, 120, '地区'), latitude, longitude };
  }
  return { title: text(data.title, 100, '标题'), city };
}
