const el = (tag, cls, text) => { const node = document.createElement(tag); node.className = cls; if (text) node.textContent = text; return node; };

export function qrBinding({ api, onBound, signal }) {
  const root = el('section', 'games-qr'), buttons = el('div', 'games-qr-actions'), panel = el('div', 'games-qr-panel'); panel.hidden = true;
  const title = el('strong', ''), image = el('img', 'games-qr-image'), note = el('p', ''), status = el('p', 'games-qr-status'), cancel = el('button', 'text-button', '关闭二维码');
  image.alt = '游戏社区账号绑定二维码'; status.setAttribute('role', 'status'); cancel.type = 'button';
  panel.append(title, image, note, status, cancel); root.append(buttons, panel);
  let flow, timer, generation = 0, disposed = false;
  function clear() { clearTimeout(timer); timer = undefined; }
  async function close() {
    generation++; clear(); const previous = flow; flow = undefined; panel.hidden = true; image.removeAttribute('src');
    if (previous) { try { await api('qr/cancel', 'POST', { id: previous.id }); } catch { /* Expiry also invalidates abandoned tickets. */ } }
  }
  async function poll(current) {
    if (disposed || current !== generation || !flow) return;
    if (Date.now() >= flow.expiresAt) { image.hidden = true; status.textContent = '二维码已过期，请重新生成。'; return; }
    if (document.visibilityState === 'hidden') { timer = setTimeout(() => poll(current), 3000); return; }
    try {
      const result = await api('qr/status', 'POST', { id: flow.id });
      if (disposed || current !== generation) return;
      if (result.state === 'bound') {
        image.hidden = true; status.textContent = '绑定成功，正在同步游戏状态…';
        await onBound(); if (current === generation) status.textContent = '绑定成功，游戏状态已更新。'; return;
      }
      if (['error', 'expired'].includes(result.state)) { image.hidden = true; status.textContent = result.message || '二维码已过期，请重新生成。'; return; }
      const seconds = Math.max(0, Math.ceil((flow.expiresAt - Date.now()) / 1000));
      status.textContent = result.state === 'scanned' ? `已扫码，请在手机上确认 · 剩余 ${seconds} 秒` : `等待扫码授权 · 剩余 ${seconds} 秒`;
      timer = setTimeout(() => poll(current), 3000);
    } catch (error) { if (!disposed && current === generation) { image.hidden = true; status.textContent = error.message; } }
  }
  for (const [provider, name, games] of [['miyoushe', '米游社', '原神'], ['skland', '森空岛', '明日方舟、终末地']]) {
    const button = el('button', 'button outline', `${name}扫码绑定`); button.type = 'button'; buttons.append(button);
    button.addEventListener('click', async () => {
      await close(); if (disposed) return;
      const current = ++generation; panel.hidden = false; image.hidden = true;
      title.textContent = `${name} · ${games}`; note.textContent = `使用${name} App 扫码并确认授权；手机浏览时可保存二维码后在 App 中识别。`;
      status.textContent = '正在生成二维码…';
      try {
        const created = await api('qr/start', 'POST', { provider });
        if (disposed || current !== generation) { void api('qr/cancel', 'POST', { id: created.id }).catch(() => {}); return; }
        flow = created;
        const { qrcodegen } = await import('./vendor/qrcodegen.js');
        if (disposed || current !== generation) return;
        const qr = qrcodegen.QrCode.encodeText(created.qr, qrcodegen.QrCode.Ecc.MEDIUM), scale = 6;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = (qr.size + 8) * scale;
        const paint = canvas.getContext('2d'); paint.fillStyle = '#fff'; paint.fillRect(0, 0, canvas.width, canvas.height); paint.fillStyle = '#000';
        for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) paint.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
        image.src = canvas.toDataURL('image/png'); image.hidden = false; status.textContent = '等待扫码授权…';
        timer = setTimeout(() => poll(current), 3000);
      } catch (error) { if (!disposed && current === generation) status.textContent = error.message; }
    }, { signal });
  }
  cancel.addEventListener('click', close, { signal });
  return { root, close, dispose() { disposed = true; generation++; clear(); image.removeAttribute('src'); } };
}
