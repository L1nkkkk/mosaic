import { field, fields } from '../../web/ui.js';
import { mediaField, imageElement } from '../media.js';
export { validate } from './definition.js';
const labels = { want: '想读', reading: '在读', done: '已读' };
export function edit({ data: initial, change }) {
  let data = structuredClone(initial); const update = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
  const decor = document.createElement('label'); decor.className = 'field books-decor-field'; const box = document.createElement('input'); box.type = 'checkbox'; box.checked = data.decor; box.setAttribute('aria-label', '空位摆件');
  box.onchange = () => update({ decor: box.checked }); const caption = document.createElement('span'); caption.append(box, ' 最后一层有空位时放摆件'); decor.append(caption); wrapper.append(decor);
  for (const book of data.items) {
    const patch = value => update({ items: data.items.map(item => item.id === book.id ? { ...item, ...value } : item) });
    const row = fields(field('书名', book.title, title => patch({ title }), { maxLength: 120 }), field('作者', book.author, author => patch({ author }), { maxLength: 100 }), mediaField('书籍封面', book.cover, cover => patch({ cover })), field('推荐语', book.note, note => patch({ note }), { maxLength: 400, multiline: true }), field('书籍链接（可选）', book.url, url => patch({ url }), { maxLength: 1500, placeholder: 'https://' }));
    const status = document.createElement('label'); status.className = 'field'; const text = document.createElement('span'); text.textContent = '阅读状态'; const select = document.createElement('select');
    for (const [value, label] of Object.entries(labels)) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); } select.value = book.status; select.onchange = () => patch({ status: select.value }); status.append(text, select); row.append(status);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这本书'; remove.onclick = () => update({ items: data.items.filter(item => item.id !== book.id) }, true); row.append(remove); wrapper.append(row);
  }
  if (data.items.length < 16) { const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加书籍'; add.onclick = () => update({ items: [...data.items, { id: crypto.randomUUID(), title: '', author: '', note: '', cover: '', url: '', status: 'want' }] }, true); wrapper.append(add); }
  return wrapper;
}
// Ornaments for the room left on the last shelf; how many show depends on how much room there is.
const DECOR = '<svg class="decor-frame" viewBox="0 0 66 86" width="66" height="86"><path d="M30 78l-12 8h30l-12-8Z" fill="#3a2416"/><rect width="66" height="80" rx="2" fill="#8a5d38"/><path d="M0 0h66v3H0Z" fill="#fff2"/><rect x="6" y="6" width="54" height="68" fill="#e9dfcc"/><rect x="11" y="11" width="44" height="58" fill="#3a3560"/><circle cx="41" cy="30" r="6" fill="#e8a07a"/><path d="M11 56l12-16 9 10 8-8 15 18v9H11Z" fill="#1f2438"/><path d="M11 62l10-8 12 9 10-6 12 8v4H11Z" fill="#151a2a"/></svg><svg class="decor-stack" viewBox="0 0 98 58" width="98" height="58"><rect x="6" y="40" width="92" height="18" rx="2" fill="#2f4a6b"/><path d="M6 42h92v2H6Z" fill="#fff2"/><path d="M82 40h2v18h-2ZM86 40h1v18h-1Z" fill="#e8c97a"/><rect y="22" width="84" height="18" rx="2" fill="#7a2f2a"/><path d="M0 24h84v2H0Z" fill="#fff2"/><path d="M10 22h2v18h-2ZM15 22h1v18h-1Z" fill="#e8c97a"/><rect x="14" y="6" width="66" height="16" rx="2" fill="#3f5a3a"/><path d="M14 8h66v2H14Z" fill="#fff2"/><path d="M66 6h2v16h-2Z" fill="#e8c97a"/></svg><svg class="decor-plant" viewBox="0 0 56 84" width="56" height="84"><path d="M28 54C14 46 8 30 12 16c10 6 16 18 16 38Z" fill="#4f7a4a"/><path d="M28 54c14-8 20-24 16-38-10 6-16 18-16 38Z" fill="#3f6a3f"/><path d="M28 56C23 40 25 20 28 5c3 15 5 35 0 51Z" fill="#6a9a5a"/><path d="M11 55h34l-4 29H15Z" fill="#b5653a"/><path d="M8 49h40v8H8Z" fill="#c9774a"/><path d="M11 57h34l-.5 4h-33Z" fill="#0003"/></svg>';
// Each book keeps the same cloth, height and thickness wherever it stands: they come from its id.
const CLOTH = ['#7a2f2a', '#2f4a6b', '#3f5a3a', '#6b4a2a', '#4a3560', '#8a6a2a', '#2f5a5a', '#5a2f45', '#3a3f4a', '#8a4a2a'];
function seed(text) { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.codePointAt(0), 16777619); return value >>> 0; }
export function mount(context) {
  const card = document.createElement('article'); card.className = 'books-module'; card.dataset.ownBackground = '';
  card.innerHTML = '<h2></h2><div class="books-shelf"><div class="books-decor" aria-hidden="true"></div></div><p class="books-empty">在编辑台放入你的第一本书。</p><section class="book-detail" aria-live="polite" hidden><div class="book-detail-cover"><img alt=""><span></span></div><div class="book-detail-text"><span class="book-status"></span><h3></h3><small></small><p></p><a target="_blank" rel="noopener noreferrer">打开链接 ↗</a></div></section>';
  context.root.append(card);
  const rows = new Map(), shelf = card.querySelector('.books-shelf'), detail = card.querySelector('.book-detail');
  shelf.firstElementChild.innerHTML = DECOR;
  let books = [], open = null;
  // The book pulled off the shelf is described below it.
  function showDetail() {
    const book = books.find(item => item.id === open);
    if (!book) open = null;
    for (const [id, row] of rows) row.setAttribute('aria-expanded', String(id === open));
    detail.hidden = !book;
    if (!book) return;
    imageElement(detail.querySelector('img'), book.cover, book.title);
    const plain = detail.querySelector('.book-detail-cover span'); plain.textContent = book.title || '书籍'; plain.hidden = Boolean(book.cover);
    detail.querySelector('.book-detail-cover').style.setProperty('--book-cloth', CLOTH[seed(book.id) % CLOTH.length]);
    detail.querySelector('.book-status').textContent = labels[book.status]; detail.querySelector('.book-status').dataset.status = book.status;
    detail.querySelector('h3').textContent = book.title || '未命名'; detail.querySelector('small').textContent = book.author; detail.querySelector('p').textContent = book.note;
    const link = detail.querySelector('a'); link.hidden = !book.url; if (book.url) link.href = book.url; else link.removeAttribute('href');
  }
  return { update(data) {
    books = data.items;
    card.querySelector('h2').textContent = data.title; card.querySelector('.books-empty').hidden = books.length > 0; shelf.hidden = !books.length; shelf.lastElementChild.hidden = !data.decor;
    for (const [id, row] of rows) if (!books.some(book => book.id === id)) { row.remove(); rows.delete(id); }
    books.forEach((book, index) => {
      let row = rows.get(book.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'book'; row.innerHTML = '<img alt=""><span class="book-name"></span>';
        const value = seed(book.id);
        row.style.setProperty('--book-cloth', CLOTH[value % CLOTH.length]); row.style.setProperty('--book-h', `${112 + (value >>> 4) % 5 * 8}px`); row.style.setProperty('--book-w', `${24 + (value >>> 8) % 4 * 5}px`);
        row.onclick = () => { open = open === book.id ? null : book.id; showDetail(); };
        rows.set(book.id, row);
      }
      // A book being read stands cover out; the others show their spine.
      row.dataset.status = book.status; row.setAttribute('aria-label', `${book.title || '未命名书籍'}，${labels[book.status]}`); row.title = book.title;
      imageElement(row.querySelector('img'), book.status === 'reading' ? book.cover : '', book.title);
      row.querySelector('.book-name').textContent = book.title || '书籍'; row.querySelector('.book-name').hidden = book.status === 'reading' && Boolean(book.cover);
      if (shelf.children[index] !== row) shelf.insertBefore(row, shelf.children[index] || null);
    });
    showDetail();
  } };
}
