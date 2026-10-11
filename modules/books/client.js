import { field, fields } from '../../web/ui.js';
import { mediaField, imageElement } from '../media.js';
export { validate } from './definition.js';
const labels = { want: '想读', reading: '在读', done: '已读' };
export function edit({ data: initial, change }) {
  let data = structuredClone(initial); const update = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
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
// Each book keeps the same cloth, height and thickness wherever it stands: they come from its id.
const CLOTH = ['#7a2f2a', '#2f4a6b', '#3f5a3a', '#6b4a2a', '#4a3560', '#8a6a2a', '#2f5a5a', '#5a2f45', '#3a3f4a', '#8a4a2a'];
function seed(text) { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.codePointAt(0), 16777619); return value >>> 0; }
export function mount(context) {
  const card = document.createElement('article'); card.className = 'books-module'; card.dataset.ownBackground = '';
  card.innerHTML = '<h2></h2><div class="books-shelf"></div><p class="books-empty">在编辑台放入你的第一本书。</p><section class="book-detail" aria-live="polite" hidden><div class="book-detail-cover"><img alt=""><span></span></div><div class="book-detail-text"><span class="book-status"></span><h3></h3><small></small><p></p><a target="_blank" rel="noopener noreferrer">打开链接 ↗</a></div></section>';
  context.root.append(card);
  const rows = new Map(), shelf = card.querySelector('.books-shelf'), detail = card.querySelector('.book-detail');
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
    card.querySelector('h2').textContent = data.title; card.querySelector('.books-empty').hidden = books.length > 0; shelf.hidden = !books.length;
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
