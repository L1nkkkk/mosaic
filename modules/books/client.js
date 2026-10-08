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
export function mount(context) {
  const card = document.createElement('article'); card.className = 'books-module'; card.innerHTML = '<h2></h2><div class="books-list"></div><p class="books-empty">在编辑台放入你的第一本书。</p>'; context.root.append(card);
  const rows = new Map(), list = card.querySelector('.books-list');
  return { update(data) {
    card.querySelector('h2').textContent = data.title; card.querySelector('.books-empty').hidden = data.items.length > 0;
    for (const [id, row] of rows) if (!data.items.some(book => book.id === id)) { row.remove(); rows.delete(id); }
    data.items.forEach((book, index) => {
      let row = rows.get(book.id);
      if (!row) { row = document.createElement('div'); row.className = 'book-item'; row.innerHTML = '<a class="book-cover" target="_blank" rel="noopener noreferrer"><img alt=""><span></span></a><span class="book-status"></span><h3></h3><small></small><p></p>'; rows.set(book.id, row); }
      const link = row.querySelector('a'); if (book.url) link.href = book.url; else link.removeAttribute('href'); link.setAttribute('aria-label', book.title || '未命名书籍');
      imageElement(row.querySelector('img'), book.cover, book.title); row.querySelector('.book-cover span').textContent = book.title || '书籍'; row.querySelector('.book-cover span').hidden = Boolean(book.cover);
      row.querySelector('.book-status').textContent = labels[book.status]; row.querySelector('h3').textContent = book.title || '未命名'; row.querySelector('small').textContent = book.author; row.querySelector('p').textContent = book.note;
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
  } };
}
