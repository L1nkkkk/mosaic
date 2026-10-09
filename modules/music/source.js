// Parse only known song pages. Never keep share tracking parameters.
export function neteaseId(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !['music.163.com', 'y.music.163.com', 'm.music.163.com'].includes(url.hostname) || url.username || url.password || url.port) return '';
    const route = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), 'https://music.163.com') : url;
    if (!['/song', '/m/song', '/song/'].includes(route.pathname)) return '';
    const id = route.searchParams.get('id');
    return /^[1-9]\d{0,15}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
export const songPage = id => `https://music.163.com/song?id=${id}`;
export function coverUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && /^p[1-9]\.music\.126\.net$/.test(url.hostname) && !url.username && !url.password && !url.port) { url.protocol = 'https:'; url.search = '?param=240y240'; url.hash = ''; return url.href; } } catch { /* Reject untrusted image sources. */ }
  throw new Error('网易云封面地址无效。');
}
export const modes = { sequence: '顺序播放', loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };
export function nextTrack(tracks, currentId, mode, direction = 1, ended = false, random = Math.random) {
  if (!tracks.length) return undefined;
  const index = Math.max(0, tracks.findIndex(track => track.id === currentId));
  if (ended && mode === 'single') return tracks[index].id;
  if (mode === 'shuffle' && direction > 0 && tracks.length > 1) {
    const others = tracks.filter(track => track.id !== tracks[index].id);
    return others[Math.floor(random() * others.length)].id;
  }
  if (ended && mode === 'sequence' && index === tracks.length - 1) return undefined;
  return tracks[(index + direction + tracks.length) % tracks.length].id;
}
