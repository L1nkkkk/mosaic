import { text } from '../../web/ui.js';
import { httpsLink } from './address.js';
export const meta = {
  id: 'browser', name: '浏览器', version: 1, privateOnly: true,
  description: '在卡片里打开网站，沿用本机浏览器的登录；需要安装 Mosaic Browser 扩展，仅自己可见。',
  layout: { span: 12, minWidth: 320, aspectRatio: 1.6 },
  defaultData: { title: '浏览器', home: 'https://www.bilibili.com/', search: 'https://www.bing.com/search?q=%s', bookmarks: [{ label: '哔哩哔哩', url: 'https://www.bilibili.com/' }] },
};
export function validate(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('浏览器内容需要是一个对象。');
  const bookmarks = data.bookmarks ?? [];
  if (!Array.isArray(bookmarks) || bookmarks.length > 12) throw new Error('书签最多放置 12 个。');
  const search = httpsLink(data.search, '搜索地址', meta.defaultData.search);
  if (!search.includes('%s')) throw new Error('搜索地址需要包含 %s 作为关键词位置。');
  return {
    title: text(data.title, 100, '标题'), home: httpsLink(data.home, '主页', meta.defaultData.home), search,
    bookmarks: bookmarks.map(item => ({ label: text(item?.label, 40, '书签名称'), url: httpsLink(item?.url, '书签地址') })),
  };
}
