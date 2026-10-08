// Fixed upstream URLs are owned by providers; never fetch arbitrary user URLs.
export async function externalJson(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { 'Accept': 'application/json' } });
  if (!response.ok) throw new Error('外部数据暂时不可用。');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 512 * 1024) throw new Error('外部响应过大。'); chunks.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally { await reader.cancel().catch(() => {}); }
}
export function cachedProvider(ttl, load, max = 100) {
  const values = new Map();
  return async key => {
    const previous = values.get(key), now = Date.now();
    if (previous && now - previous.at < ttl) return previous.promise;
    if (values.size >= max && !previous) values.delete(values.keys().next().value);
    const entry = { at: now, promise: Promise.resolve().then(() => load(key)) };
    values.set(key, entry);
    try { return await entry.promise; } catch (error) { entry.at = now - ttl + 60000; throw error; }
  };
}
