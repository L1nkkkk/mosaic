import { field, fields } from '../../web/ui.js';
import { mediaField, imageElement } from '../media.js';
import { neteaseId, songPage, modes, nextTrack } from './source.js';
export { validate } from './definition.js';
export function edit({ data: initial, change }) {
  let data = structuredClone(initial);
  const update = (patch, refresh = false) => { data = { ...data, ...patch }; change(data, refresh); };
  const wrapper = fields(field('标题', data.title, title => update({ title }), { maxLength: 100 }));
  const modeField = document.createElement('label'); modeField.className = 'field'; modeField.innerHTML = '<span>播放顺序</span><select aria-label="播放顺序"></select>';
  const mode = modeField.querySelector('select'); for (const [value, title] of Object.entries(modes)) mode.add(new Option(title, value)); mode.value = data.mode || 'sequence'; mode.onchange = () => update({ mode: mode.value });
  const auto = document.createElement('label'); auto.className = 'music-auto'; auto.innerHTML = '<input type="checkbox" aria-label="进入网页时自动播放"><span>进入网页时尝试自动播放</span>'; auto.querySelector('input').checked = Boolean(data.autoplay); auto.querySelector('input').onchange = event => update({ autoplay: event.target.checked });
  const help = document.createElement('p'); help.className = 'scope-help'; help.textContent = '自动播放受浏览器限制，未获允许时需要点击播放。编辑台与实验台不会自动播放；有多个播放器时只自动启动一个。';
  const importer = document.createElement('div'); importer.className = 'music-import'; importer.innerHTML = '<label class="field"><span>网易云歌曲链接</span><input type="url" aria-label="网易云歌曲链接" placeholder="https://music.163.com/song?id=…"></label><button type="button" class="button outline small">识别并加入歌单</button><small role="status">可粘贴歌曲分享链接，自动填写曲名、歌手和封面。</small>';
  const importButton = importer.querySelector('button'), importStatus = importer.querySelector('small');
  importButton.onclick = async () => {
    const id = neteaseId(importer.querySelector('input').value);
    if (!id) { importStatus.textContent = '请粘贴 music.163.com 的歌曲链接（包含 song?id=），暂不支持歌单或短链接。'; return; }
    const existing = data.tracks.find(track => (track.neteaseId || neteaseId(track.audio)) === id);
    if (!existing && data.tracks.length >= 12) { importStatus.textContent = '歌单最多 12 首，请先移除一首。'; return; }
    importButton.disabled = true; importStatus.textContent = '正在识别歌曲…';
    try {
      const response = await fetch(new URL(`api/admin/netease?id=${id}`, document.baseURI)); const info = await response.json(); if (!response.ok) throw new Error(info.error);
      const track = { id: existing?.id || crypto.randomUUID(), title: info.title, artist: info.artist, audio: '', cover: existing?.cover || '', neteaseId: id, neteaseCover: info.cover };
      update({ tracks: existing ? data.tracks.map(item => item.id === existing.id ? track : item) : [...data.tracks, track] }, true);
    } catch (error) { importStatus.textContent = error.message; }
    finally { importButton.disabled = false; }
  };
  wrapper.append(modeField, auto, help, importer);
  data.tracks.forEach((track, index) => {
    const patch = value => update({ tracks: data.tracks.map(item => item.id === track.id ? { ...item, ...value } : item) });
    const row = fields(field(`歌曲 ${index + 1} · 曲名`, track.title, title => patch({ title }), { maxLength: 120 }), field('音乐人', track.artist, artist => patch({ artist }), { maxLength: 100 }), mediaField('音频或替换为本地音频', track.audio, audio => { const id = neteaseId(audio); patch({ audio: id ? '' : audio, neteaseId: id, neteaseCover: id === track.neteaseId ? track.neteaseCover : '' }); }, 'audio'), mediaField('唱片封面', track.cover, cover => patch({ cover })));
    if (track.neteaseId) { const link = document.createElement('a'); link.href = songPage(track.neteaseId); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'music-source'; link.textContent = '已关联网易云歌曲 ↗ · 播放取决于歌曲外链可用性'; row.prepend(link); }
    const order = document.createElement('div'); order.className = 'music-order';
    for (const [offset, label] of [[-1, '提前'], [1, '后移']]) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button outline small'; button.textContent = offset < 0 ? '↑ 提前' : '↓ 后移'; button.setAttribute('aria-label', `${label}歌曲 ${index + 1}`); button.disabled = index + offset < 0 || index + offset >= data.tracks.length; button.onclick = () => { const tracks = [...data.tracks]; [tracks[index], tracks[index + offset]] = [tracks[index + offset], tracks[index]]; update({ tracks }, true); }; order.append(button); }
    row.append(order);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = '移除这首歌'; remove.onclick = () => update({ tracks: data.tracks.filter(item => item.id !== track.id) }, true); row.append(remove); wrapper.append(row);
  });
  if (data.tracks.length < 12) { const add = document.createElement('button'); add.type = 'button'; add.className = 'button subtle'; add.textContent = '＋ 添加歌曲'; add.onclick = () => update({ tracks: [...data.tracks, { id: crypto.randomUUID(), title: '', artist: '', audio: '', cover: '' }] }, true); wrapper.append(add); }
  return wrapper;
}

const players = new Set();
let autoplayClaimed = false;
export function mount(context) {
  const card = document.createElement('article'); card.className = 'music-module';
  card.innerHTML = '<h2></h2><div class="music-now"><div class="music-record"><img alt=""><span aria-hidden="true">●</span></div><div class="music-info"><h3></h3><p></p></div></div><audio controls preload="none"></audio><div class="music-playlist"><button type="button" aria-label="上一首">‹</button><select aria-label="播放列表"></select><button type="button" aria-label="下一首">›</button></div><div class="music-bottom"><span class="music-mode"></span><a class="music-source" target="_blank" rel="noopener noreferrer" hidden>在网易云打开 ↗</a><button type="button" class="music-start button outline small" hidden>点击播放</button></div><p class="music-status" role="status"></p>';
  context.root.append(card);
  const audio = card.querySelector('audio'), playlist = card.querySelector('select'), status = card.querySelector('.music-status'), start = card.querySelector('.music-start'), link = card.querySelector('a');
  players.add(audio);
  let tracks = [], current, info, key = '', generation = 0, disposed = false, resolving = false, wantsPlay = false, autoplayTried = false, mode = 'sequence', auto = false;
  const history = [];
  const songId = () => current?.neteaseId || neteaseId(current?.audio);
  function labels() {
    card.querySelector('h3').textContent = current?.title || info?.title || (songId() ? '网易云歌曲' : '还没有歌曲');
    card.querySelector('.music-info p').textContent = current?.artist || info?.artist || '留一首最近喜欢的音乐';
    imageElement(card.querySelector('img'), current?.cover || current?.neteaseCover || info?.cover || '', current?.title || info?.title || '');
    const id = songId(); link.hidden = !id; if (id) link.href = songPage(id); else link.removeAttribute('href');
    playlist.value = current?.id || ''; playlist.disabled = !tracks.length;
    card.querySelectorAll('.music-playlist button').forEach(button => { button.disabled = tracks.length < 2; });
  }
  async function play() {
    if (!audio.dataset.source || disposed) return;
    wantsPlay = true; const token = generation;
    try { await audio.play(); }
    catch (error) {
      if (disposed || token !== generation || error.name === 'AbortError') return;
      wantsPlay = false; start.hidden = false; start.textContent = '点击播放';
      status.textContent = error.name === 'NotAllowedError' ? '浏览器未允许自动播放，点击播放即可。' : songId() ? '歌曲暂时无法外链播放，可重试、在网易云打开或上传音频。' : '音频无法播放，请检查文件或直链。';
    }
  }
  function maybePlay() {
    if (wantsPlay) { void play(); return; }
    if (auto && !autoplayTried && !autoplayClaimed && !['edit','lab'].includes(context.view) && audio.dataset.source) {
      autoplayTried = true; autoplayClaimed = true; void play();
    }
  }
  function setSource(source) {
    resolving = false;
    audio.dataset.source = source; audio.hidden = !source;
    if (source) { audio.src = source; audio.load(); start.hidden = true; status.textContent = '点击播放'; maybePlay(); }
    else { start.hidden = !songId(); start.textContent = '重新尝试'; status.textContent = songId() ? '已识别歌曲，但暂时没有可用外链音频。可在网易云打开或上传音频。' : '在编辑台添加歌曲和音频。'; }
  }
  function choose(id, { playing = false, restart = false, force = false } = {}) {
    current = tracks.find(track => track.id === id) || tracks[0]; labels();
    const netease = songId(), nextKey = `${current?.id || ''}|${netease ? 'netease:' + netease : current?.audio || ''}`;
    if (nextKey === key && !force) { if (playing) { if (restart) audio.currentTime = 0; void play(); } return; }
    key = nextKey; const token = ++generation; info = undefined; labels(); resolving = Boolean(netease); card.classList.remove('playing');
    audio.pause(); audio.removeAttribute('src'); audio.dataset.source = ''; audio.load(); audio.hidden = true;
    wantsPlay = playing; start.hidden = true;
    if (netease) {
      status.textContent = '正在读取网易云歌曲…';
      context.request(`music/netease?id=${netease}`).then(value => {
        if (disposed || generation !== token) return;
        info = value; labels(); setSource(value.audio || '');
      }).catch(() => { if (!disposed && generation === token) { setSource(''); status.textContent = '网易云暂时不可用，点击重新尝试或在网易云打开。'; } });
    } else {
      let source = ''; try { if (current?.audio) source = new URL(current.audio, document.baseURI).href; } catch { /* Allow the editor to finish typing a URL. */ }
      setSource(source);
    }
  }
  function advance(direction, ended = false) {
    const previous = direction < 0 && mode === 'shuffle' ? history.pop() : undefined;
    const id = previous && tracks.some(track => track.id === previous) ? previous : nextTrack(tracks, current?.id, mode, direction, ended);
    if (!id) { wantsPlay = false; status.textContent = '歌单已播放完毕'; return; }
    if (direction > 0 && current?.id && id !== current.id) { history.push(current.id); if (history.length > 100) history.shift(); }
    choose(id, { playing: ended || !audio.paused || wantsPlay, restart: ended });
  }
  playlist.onchange = () => choose(playlist.value, { playing: !audio.paused || wantsPlay });
  card.querySelector('[aria-label="上一首"]').onclick = () => advance(-1);
  card.querySelector('[aria-label="下一首"]').onclick = () => advance(1);
  start.onclick = () => { if (!audio.dataset.source || audio.error) choose(current?.id, { playing: true, force: true }); else void play(); };
  audio.onplay = () => { for (const other of players) if (other !== audio) other.pause(); wantsPlay = true; card.classList.add('playing'); start.hidden = true; status.textContent = '正在播放'; };
  audio.onpause = () => { if (resolving || !audio.paused) return; wantsPlay = false; card.classList.remove('playing'); if (audio.currentTime) status.textContent = '已暂停'; };
  audio.onended = () => { card.classList.remove('playing'); advance(1, true); };
  audio.onerror = () => { wantsPlay = false; start.hidden = false; start.textContent = '重新尝试'; status.textContent = songId() ? '歌曲暂时无法外链播放，可重试、在网易云打开或上传音频。' : '音频无法播放，请检查文件或直链。'; };
  return {
    update(data) {
      card.querySelector('h2').textContent = data.title; tracks = data.tracks; mode = data.mode || 'sequence'; auto = Boolean(data.autoplay); card.querySelector('.music-mode').textContent = modes[mode];
      playlist.replaceChildren(...tracks.map(track => { const option = document.createElement('option'); option.value = track.id; option.textContent = track.title || (track.neteaseId ? '网易云歌曲' : '未命名歌曲'); return option; })); choose(current?.id);
    },
    setActive(active) { card.classList.toggle('music-visible', active); },
    dispose() { disposed = true; generation++; players.delete(audio); audio.pause(); audio.removeAttribute('src'); audio.load(); },
  };
}
