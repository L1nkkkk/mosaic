// A wheel gesture that starts on the page keeps scrolling the page: while the page moves, module
// content ignores the pointer, and takes it back once the pointer really moves, clicks or a key is pressed.
export function guardPageScroll(root = document.documentElement) {
  let x = 0, y = 0, origin, handover = false;
  const release = () => { origin = undefined; root.classList.remove('is-page-scrolling'); };
  addEventListener('scroll', event => {
    if (event.target !== document || origin) return;
    origin = { x, y }; root.classList.add('is-page-scrolling');
  }, { capture: true, passive: true });
  addEventListener('pointermove', event => {
    x = event.clientX; y = event.clientY;
    // Content sliding under a still pointer also reports movement; only a real change of position counts.
    if (origin && Math.hypot(x - origin.x, y - origin.y) > 4) release();
  }, { capture: true, passive: true });
  addEventListener('keydown', release, true);
  addEventListener('pointerdown', () => { handover = Boolean(origin); release(); }, true);
  // That press landed on the card frame rather than the control under the pointer; pass the click on.
  addEventListener('click', event => {
    if (!handover || !event.isTrusted) return;
    handover = false;
    let target = document.elementFromPoint(event.clientX, event.clientY);
    while (target?.shadowRoot) { const inner = target.shadowRoot.elementFromPoint(event.clientX, event.clientY); if (!inner || inner === target) break; target = inner; }
    if (!(target instanceof HTMLElement) || target === event.target || !target.closest('.module-content')) return;
    event.stopImmediatePropagation(); event.preventDefault();
    target.focus({ preventScroll: true }); target.click();
  }, true);
}
