import { text, safeLink } from '../../web/ui.js';
import { mediaUrl } from '../media.js';
export const meta = { id: 'photo', name: '照片卡片', version: 1, layout: { span: 4, minWidth: 220, aspectRatio: .85 }, description: '一张照片、一段文字，可调整裁切位置和文字遮罩。', defaultData: { title: '生活碎片', caption: '', image: '', alt: '', url: '', position: 50, shade: 65 } };
export function validate(data = {}) {
  const position = data.position ?? 50, shade = data.shade ?? 65;
  if (![position, shade].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error('位置和遮罩应在 0–100 之间。');
  return { title: text(data.title, 100, '标题'), caption: text(data.caption, 600, '配文'), image: mediaUrl(data.image), alt: text(data.alt, 200, '图片描述'), url: safeLink(data.url), position, shade };
}
