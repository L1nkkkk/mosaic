export const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function text(value, max, label, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || result.length > max) throw new Error(`${label}最多 ${max} 个字。`);
  return result.trim();
}

export function safeLink(value) {
  const result = text(value, 1500, '链接');
  if (!result) return '';
  try { const url = new URL(result); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); } catch { throw new Error('链接需要以 https:// 或 http:// 开头。'); }
  return result;
}

export function field(label, value, onChange, { multiline = false, maxLength = 200, placeholder = '' } = {}) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (multiline) input.rows = 5;
  else input.type = 'text';
  input.value = value || '';
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(input.value));
  wrapper.append(caption, input);
  return wrapper;
}

export function fields(...items) {
  const wrapper = document.createElement('div');
  wrapper.className = 'module-fields';
  wrapper.append(...items);
  return wrapper;
}
