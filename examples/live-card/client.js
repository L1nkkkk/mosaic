import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
export function edit({ data, change }) {
  return fields(field('标题', data.title, title => change({ title }), { maxLength: 100 }));
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'live-card';
  const heading = document.createElement('h2'), button = document.createElement('button');
  button.type = 'button';
  let clicks = 0; // Runtime-only; resizing, reordering and updates keep this closure.
  const label = () => { button.textContent = `本次点击 ${clicks} 次`; };
  button.addEventListener('click', () => { clicks++; label(); }, { signal: context.signal });
  card.append(heading, button); context.root.append(card); label();
  return {
    update(data) { heading.textContent = data.title; },
    // Optional: resize(size), frame(time, delta), setActive(active), dispose().
    // Persist actual content explicitly with await context.save(nextData).
  };
}
