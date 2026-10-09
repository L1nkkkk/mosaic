import { cachedProvider, externalJson } from './external.js';
import { coverUrl, songPage } from '../modules/music/source.js';
export function songId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value)) throw Object.assign(new Error('请选择有效的网易云歌曲链接。'), { status: 400 });
  return value;
}
export function playbackUrl(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && /^[a-zA-Z0-9-]+\.music\.126\.net$/.test(url.hostname) && !url.username && !url.password && !url.port) { url.protocol = 'https:'; return url.href; }
  } catch { /* Never return arbitrary redirects. */ }
  return '';
}
export function musicProvider(fetcher = fetch) {
  let window = 0, count = 0;
  const budget = () => { const now = Math.floor(Date.now() / 60000); if (window !== now) { window = now; count = 0; } if (++count > 60) throw new Error('音乐查询较多，请稍后重试。'); };
  const metadata = cachedProvider(6 * 3600000, async id => {
    budget();
    const result = await externalJson(`https://music.163.com/api/song/detail/?id=${id}&ids=%5B${id}%5D`, fetcher);
    const song = result.songs?.find(song => String(song.id) === id);
    if (!song || typeof song.name !== 'string') throw new Error('没有找到这首歌，可能已下架或暂时无法查询。');
    let cover = ''; try { cover = coverUrl(song.album?.picUrl); } catch { /* A cover failure does not hide a song. */ }
    return { id, title: song.name.slice(0, 120), artist: (song.artists || []).map(artist => String(artist.name || '')).join(' / ').slice(0, 100), cover, page: songPage(id) };
  });
  const playback = cachedProvider(60000, async id => {
    budget();
    // Ask only the provider's public external-player endpoint; never proxy audio or use account cookies.
    const response = await fetcher(`https://music.163.com/song/media/outer/url?id=${id}.mp3`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    try { return [301,302,303,307,308].includes(response.status) ? playbackUrl(response.headers.get('location')) : ''; }
    finally { await response.body?.cancel().catch(() => {}); }
  });
  return { metadata: id => metadata(songId(id)), async resolve(id) {
    songId(id);
    const info = await metadata(id);
    let audio = ''; try { audio = await playback(id); } catch { /* Metadata still works when playback is unavailable. */ }
    return { ...info, audio, playable: Boolean(audio) };
  } };
}
