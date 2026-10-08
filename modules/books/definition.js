import { text, safeLink } from '../../web/ui.js';
import { mediaUrl } from '../media.js';
export const meta = { id: 'books', name: '书单', version: 1, layout: { span: 6, minWidth: 260 }, description: '封面、作者、阅读状态与简短推荐，可添加书籍链接。', defaultData: { title: '书架', items: [] } };
export function validate(data = {}) {
  if (!Array.isArray(data.items) || data.items.length > 16) throw new Error('书单最多 16 本。');
  const seen = new Set();
  return { title: text(data.title, 100, '标题'), items: data.items.map(item => {
    if (!item || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id)) throw new Error('书籍编号无效。'); seen.add(item.id);
    if (!['want', 'reading', 'done'].includes(item.status)) throw new Error('请选择阅读状态。');
    return { id: item.id, title: text(item.title, 120, '书名'), author: text(item.author, 100, '作者'), note: text(item.note, 400, '推荐语'), cover: mediaUrl(item.cover), url: safeLink(item.url), status: item.status };
  }) };
}
