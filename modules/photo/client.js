import { field, fields } from '../../web/ui.js';
import { mediaField, imageElement } from '../media.js';
export { validate } from './definition.js';
export function edit({ data: initial, change }) {
  let data = structuredClone(initial); const update = patch => { data = { ...data, ...patch }; change(data); };
  const wrapper = fields(mediaField('照片', data.image, image => update({ image })), field('标题', data.title, title => update({ title }), { maxLength: 100 }), field('配文', data.caption, caption => update({ caption }), { maxLength: 600, multiline: true }), field('图片描述（辅助阅读）', data.alt, alt => update({ alt }), { maxLength: 200 }), field('点击跳转（可选）', data.url, url => update({ url }), { maxLength: 1500, placeholder: 'https://' }));
  for (const [key, name] of [['position', '上下裁切位置'], ['shade', '文字遮罩深度']]) {
    const label = document.createElement('label'); label.className = 'field'; const text = document.createElement('span'); text.textContent = name; const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = data[key]; slider.oninput = () => update({ [key]: Number(slider.value) }); label.append(text, slider); wrapper.append(label);
  }
  return wrapper;
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'photo-module'; card.dataset.ownBackground = ''; card.innerHTML = '<img class="photo-image" alt=""><div class="photo-shade"></div><span class="photo-placeholder">上传一张照片，留住一个瞬间。</span><div class="photo-copy"><h2></h2><p></p><a target="_blank" rel="noopener noreferrer" aria-label="打开照片链接">↗</a></div>'; context.root.append(card);
  return { update(data) {
    imageElement(card.querySelector('img'), data.image, data.alt || data.title); card.querySelector('img').style.objectPosition = `50% ${data.position}%`;
    card.querySelector('.photo-shade').style.opacity = String(data.shade / 100); card.querySelector('.photo-placeholder').hidden = Boolean(data.image);
    card.querySelector('h2').textContent = data.title; card.querySelector('p').textContent = data.caption;
    const link = card.querySelector('a'); link.hidden = !data.url; if (data.url) link.href = data.url; else link.removeAttribute('href');
  } };
}
