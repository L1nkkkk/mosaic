import { text } from '../../web/ui.js';
export const meta = {
  id: 'shader', name: '流动色场', version: 1, description: '独立 WebGL 画布；拖动和缩放时保持连续，离屏自动暂停。',
  animation: 'continuous', layout: { span: 6, minWidth: 240, aspectRatio: 1.4 },
  defaultData: { title: '让颜色慢慢流动', speed: 0.35, hue: 0.65 },
};
export function validate(data = {}) {
  if (!data || !Number.isFinite(data.speed) || data.speed < 0 || data.speed > 2 || !Number.isFinite(data.hue) || data.hue < 0 || data.hue > 1) throw new Error('速度需在 0–2 之间，色相需在 0–1 之间。');
  return { title: text(data.title, 100, '标题'), speed: data.speed, hue: data.hue };
}
