import assert from 'node:assert/strict';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({ base, command, evaluate, waitFor }) => {
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['https://*'] });
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelectorAll(".module-slot").length > 0');
  // A short, full-width note with long content sits mid-page as the module that could trap the wheel.
  await evaluate(`(async () => {
    const state = await (await fetch('api/admin/state')).json();
    const modules = state.draft.modules, note = modules.splice(modules.findIndex(item => item.type === 'note'), 1)[0];
    note.data.body = Array.from({ length: 300 }, (_, line) => 'line ' + line).join('\\n'); note.layout = { span: 12, height: 240 };
    modules.splice(2, 0, note);
    const saved = await fetch('api/admin/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, page: state.draft }) });
    if (!saved.ok) throw new Error(await saved.text());
  })()`);
  await command('Page.navigate', { url: base + '/private' });
  const note = 'document.querySelector(".note-module").closest(".module-content")';
  await waitFor(`document.querySelector(".note-module") && ${note}.scrollHeight > ${note}.clientHeight + 200`);
  const pause = () => new Promise(resolve => setTimeout(resolve, 220));
  const state = () => evaluate(`({ page: Math.round(scrollY), inner: Math.round(${note}.scrollTop), guarded: document.documentElement.classList.contains('is-page-scrolling'), events: getComputedStyle(${note}).pointerEvents })`);

  // Start on a spot that is not a scrolling module, below which the note will slide under the pointer.
  const start = await evaluate(`(() => {
    const box = ${note}.getBoundingClientRect(), x = Math.round(box.left + box.width / 2);
    for (let y = 120; y < box.top - 20; y += 10) {
      const content = document.elementFromPoint(x, y)?.closest('.module-content');
      if (!content || content.scrollHeight <= content.clientHeight) return { x, y };
    }
    return null;
  })()`);
  assert.ok(start, 'The note must begin below a spot where the page takes the wheel');
  const { x, y } = start;
  const wheel = async (px = x, py = y) => { await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px, y: py, deltaX: 0, deltaY: 100 }); await pause(); };
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const under = `(() => { const box = ${note}.getBoundingClientRect(); return box.top < ${y} - 30 && box.bottom > ${y} + 30; })()`;
  for (let turn = 0; turn < 40 && !await evaluate(under); turn++) await wheel();
  assert.ok(await evaluate(under), 'The note should have slid under the still pointer');

  // The pointer has not moved, so the wheel keeps moving the page instead of the note.
  const arrived = await state();
  assert.deepEqual([arrived.guarded, arrived.events, arrived.inner], [true, 'none', 0]);
  await wheel();
  const carried = await state();
  assert.ok(carried.page > arrived.page + 50 && carried.inner === 0, JSON.stringify({ arrived, carried }));

  // Moving the pointer onto the note hands the wheel to it, and its end still does not move the page.
  await evaluate(`scrollTo(0, scrollY + ${note}.getBoundingClientRect().top - ${y} + 100)`);
  await pause();
  for (const step of [8, 16]) await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + step, y });
  const released = await state();
  assert.deepEqual([released.guarded, released.events], [false, 'auto']);
  await wheel(x + 16); await wheel(x + 16);
  const inside = await state();
  assert.ok(inside.inner > 100 && inside.page === released.page, JSON.stringify({ released, inside }));

  // A click on a control that scrolled under the still pointer is not lost.
  const box = await evaluate(`(() => { const input = document.querySelector('.todo-module input[type="checkbox"]'); input.scrollIntoView({ block: 'center' }); const r = input.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await pause();
  await evaluate('scrollBy(0, 1)');
  await waitFor('document.documentElement.classList.contains("is-page-scrolling")');
  for (const type of ['mousePressed', 'mouseReleased']) await command('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await waitFor('document.querySelector(\'.todo-module input[type="checkbox"]\').checked');
  assert.equal((await state()).guarded, false);

  // The framed site of the browser module is covered by the same guard.
  await evaluate('document.documentElement.dataset.mosaicBrowser = "test"');
  await waitFor('!!document.querySelector(".browser-module iframe")');
  const framed = 'getComputedStyle(document.querySelector(".browser-module iframe").closest(".module-content")).pointerEvents';
  await evaluate('scrollBy(0, 1)');
  await waitFor(`${framed} === 'none'`);
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))');
  assert.equal(await evaluate(framed), 'auto');
  console.log('Page scroll: the wheel stays with the page until the pointer moves; clicks and keys release it.');
});
