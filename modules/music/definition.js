import { text } from '../../web/ui.js';
import { mediaUrl } from '../media.js';
import { neteaseId, coverUrl, modes } from './source.js';
export const meta = { id: 'music', name: '音乐播放器', version: 1, layout: { span: 4, minWidth: 260 }, description: '网易云歌曲识别、上传音频、歌单顺序与循环模式，可选择进入页面时播放。', defaultData: { title: '正在听', tracks: [], mode: 'sequence', autoplay: false } };
export function validate(data = {}) {
  if (!Array.isArray(data.tracks) || data.tracks.length > 12) throw new Error('播放列表最多 12 首。');
  const mode = data.mode ?? 'sequence', autoplay = data.autoplay ?? false;
  if (!Object.hasOwn(modes, mode) || typeof autoplay !== 'boolean') throw new Error('播放设置无效。');
  const seen = new Set();
  return { title: text(data.title, 100, '标题'), mode, autoplay, tracks: data.tracks.map(track => {
    if (!track || !/^[a-zA-Z0-9_-]{1,64}$/.test(track.id) || seen.has(track.id)) throw new Error('歌曲编号无效。'); seen.add(track.id);
    const songId = track.neteaseId || neteaseId(track.audio);
    if (songId && (typeof songId !== 'string' || !/^[1-9]\d{0,15}$/.test(songId))) throw new Error('网易云歌曲编号无效。');
    return { neteaseId: songId || '', neteaseCover: coverUrl(track.neteaseCover), id: track.id, title: text(track.title, 120, '曲名'), artist: text(track.artist, 100, '音乐人'), audio: songId ? '' : mediaUrl(track.audio, 'audio'), cover: mediaUrl(track.cover) };
  }) };
}
