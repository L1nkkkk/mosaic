import { text } from '../../web/ui.js';
import { mediaUrl } from '../media.js';
export const meta = { id: 'music', name: '音乐播放器', version: 1, layout: { span: 4, minWidth: 260 }, description: '唱片封面、播放列表与进度控制，支持上传音频和 HTTPS 直链。', defaultData: { title: '正在听', tracks: [] } };
export function validate(data = {}) {
  if (!Array.isArray(data.tracks) || data.tracks.length > 12) throw new Error('播放列表最多 12 首。');
  const seen = new Set();
  return { title: text(data.title, 100, '标题'), tracks: data.tracks.map(track => {
    if (!track || !/^[a-zA-Z0-9_-]{1,64}$/.test(track.id) || seen.has(track.id)) throw new Error('歌曲编号无效。'); seen.add(track.id);
    return { id: track.id, title: text(track.title, 120, '曲名'), artist: text(track.artist, 100, '音乐人'), audio: mediaUrl(track.audio, 'audio'), cover: mediaUrl(track.cover) };
  }) };
}
