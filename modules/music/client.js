import { field, fields } from '../../web/ui.js';
import { mediaField, imageElement } from '../media.js';
export { validate } from './definition.js';
export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const update = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
  data.tracks.forEach((track, index) => {
    const patch = value => update({ tracks: data.tracks.map(item => item.id === track.id ? { ...item, ...value } : item) });
    const row = fields(field(`歌曲 ${index + 1} · 曲名`, track.title, title => patch({ title }), { maxLength: 120 }), field('音乐人', track.artist, artist => patch({ artist }), { maxLength: 100 }), mediaField('音频', track.audio, audio => patch({ audio }), 'audio'), mediaField('唱片封面', track.cover, cover => patch({ cover })));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这首歌'; remove.onclick = () => update({ tracks: data.tracks.filter(item => item.id !== track.id) }, true); row.append(remove); wrapper.append(row);
  });
  if (data.tracks.length < 12) { const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加歌曲'; add.onclick = () => update({ tracks: [...data.tracks, { id: crypto.randomUUID(), title: '', artist: '', audio: '', cover: '' }] }, true); wrapper.append(add); }
  return wrapper;
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'music-module';
  card.innerHTML = '<h2></h2><div class="music-now"><div class="music-record"><img alt=""><span aria-hidden="true">●</span></div><div class="music-info"><h3></h3><p></p></div></div><audio controls preload="none"></audio><div class="music-playlist"><button type="button" aria-label="上一首">‹</button><select aria-label="播放列表"></select><button type="button" aria-label="下一首">›</button></div><p class="music-status" role="status"></p>';
  context.root.append(card);
  const audio = card.querySelector('audio'), playlist = card.querySelector('select'), status = card.querySelector('.music-status');
  let tracks = [], current = null;
  function choose(id) {
    current = tracks.find(track => track.id === id) || tracks[0];
    card.querySelector('h3').textContent = current?.title || '还没有歌曲'; card.querySelector('.music-info p').textContent = current?.artist || '留一首最近喜欢的音乐';
    imageElement(card.querySelector('img'), current?.cover || '', current?.title || '');
    const source = current?.audio ? new URL(current.audio, document.baseURI).href : '';
    if (audio.dataset.source !== source) { audio.pause(); audio.dataset.source = source; if (source) audio.src = source; else audio.removeAttribute('src'); audio.load(); }
    playlist.value = current?.id || ''; playlist.disabled = !tracks.length;
    audio.hidden = !source; status.textContent = source ? (audio.paused ? '点击播放 · 不会自动播放' : '正在播放') : '在编辑台添加歌曲和音频。';
    card.querySelectorAll('.music-playlist button').forEach(button => { button.disabled = tracks.length < 2; });
  }
  const next = direction => { if (!tracks.length) return; choose(tracks[(tracks.indexOf(current) + direction + tracks.length) % tracks.length].id); };
  playlist.onchange = () => choose(playlist.value); card.querySelector('[aria-label="上一首"]').onclick = () => next(-1); card.querySelector('[aria-label="下一首"]').onclick = () => next(1);
  audio.onplay = () => { card.classList.add('playing'); status.textContent = '正在播放'; };
  audio.onpause = () => { card.classList.remove('playing'); if (audio.currentTime) status.textContent = '已暂停'; };
  audio.onended = () => { card.classList.remove('playing'); status.textContent = '播放结束，可选择下一首'; };
  audio.onerror = () => { status.textContent = '音频无法播放，请检查文件或直链是否有效。'; };
  return {
    update(data) { card.querySelector('h2').textContent = data.title; tracks = data.tracks; playlist.replaceChildren(...tracks.map(track => { const option = document.createElement('option'); option.value = track.id; option.textContent = track.title || '未命名歌曲'; return option; })); choose(current?.id); },
    setActive(active) { card.classList.toggle('music-visible', active); },
    dispose() { audio.pause(); audio.removeAttribute('src'); audio.load(); },
  };
}
