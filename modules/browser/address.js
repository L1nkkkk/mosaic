// Shared by the server definition and the browser client; keep it free of DOM access.
export function httpsLink(value, label, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string' || result.length > 1500) throw new Error(`${label}最多 1500 个字。`);
  // The page is served over HTTPS, so an http: frame would be blocked as mixed content.
  try { if (new URL(result.trim()).protocol !== 'https:') throw new Error(); } catch { throw new Error(`${label}需要以 https:// 开头。`); }
  return result.trim();
}

// Turns address bar input into a URL: a typed address is upgraded to HTTPS, anything else becomes a search.
export function resolveAddress(input, search) {
  const value = String(input ?? '').trim();
  if (!value) return '';
  const typed = /^https?:\/\//i.test(value) ? value.replace(/^http:/i, 'https:') : /^[^\s/]+\.[^\s/.]+(\/\S*)?$/.test(value) ? `https://${value}` : '';
  try { if (typed) return new URL(typed).href; } catch { /* Fall through to a search. */ }
  return search.replace('%s', encodeURIComponent(value));
}
