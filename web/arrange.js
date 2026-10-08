import { normalizeLayout, normalizeLayoutOverride, resolveLayoutSpan, sizeModuleFrame } from './layout.js';

export function reorderModules(items, id, targetId, after = false) {
  if (id === targetId || !items.some(item => item.id === id) || !items.some(item => item.id === targetId)) return items;
  const result = items.filter(item => item.id !== id);
  const target = result.findIndex(item => item.id === targetId);
  result.splice(target + Number(after), 0, items.find(item => item.id === id));
  return result.every((item, index) => item === items[index]) ? items : result;
}

export function resizeModule(meta, override, box, delta, width, gap = 0) {
  const layout = normalizeLayout(meta);
  const result = { ...normalizeLayoutOverride(override) };
  if (Math.abs(delta.x) >= 6 && width > 0) {
    const requested = Math.max(1, Math.min(12, Math.round((box.width + delta.x + gap) * 12 / (width + gap))));
    result.span = resolveLayoutSpan({ ...layout, span: requested }, width, gap);
  }
  if (Math.abs(delta.y) >= 6) result.height = Math.max(120, Math.min(1600, Math.round((box.height + delta.y) / 8) * 8));
  return normalizeLayoutOverride(result);
}

// One delegated controller survives preview redraws. Draft changes happen only
// on drop; pointer cancellation, Escape and window changes leave data untouched.
export function attachLayoutEditor(root, { getModule, select, complete }) {
  const listeners = new AbortController();
  let gesture;
  let scrollFrame;
  let marker;
  let ghost;
  const handleFor = event => event.target.closest('[data-layout-action]');
  const idOf = element => element.closest('[data-module-id]')?.dataset.moduleId;
  const children = scope => [...scope.children].filter(element => element.dataset.moduleId);
  const focusHandle = (id, action, scopeId) => [...root.querySelectorAll('[data-layout-action]')].find(element => idOf(element) === id && element.dataset.layoutAction === action && element.closest('#' + scopeId))?.focus({ preventScroll: true });

  function clearMarker() {
    if (marker) { delete marker.dataset.drop; delete marker.dataset.dropAxis; marker = undefined; }
  }

  function updateDrop() {
    clearMarker();
    const { scope, id, point } = gesture;
    const bounds = scope.getBoundingClientRect();
    gesture.change = undefined;
    if (point.x < bounds.left - 16 || point.x > bounds.right + 16 || point.y < bounds.top - 16 || point.y > bounds.bottom + 16) return;
    const entries = children(scope).map(element => ({ element, rect: element.getBoundingClientRect() }));
    const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-module-id]');
    if (hit?.dataset.moduleId === id) return;
    const candidates = entries.filter(({ element }) => element.dataset.moduleId !== id);
    const distance = ({ rect }) => Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom));
    candidates.sort((a, b) => distance(a) - distance(b));
    const target = candidates[0];
    if (!target) return;
    const horizontal = scope.id === 'preview-page' && point.y >= target.rect.top && point.y <= target.rect.bottom && entries.some(entry => entry !== target && Math.abs(entry.rect.top - target.rect.top) < 4);
    const after = horizontal ? point.x > target.rect.left + target.rect.width / 2 : point.y > target.rect.top + target.rect.height / 2;
    marker = target.element;
    marker.dataset.drop = after ? 'after' : 'before';
    marker.dataset.dropAxis = horizontal ? 'x' : 'y';
    gesture.change = { kind: 'move', id, targetId: marker.dataset.moduleId, after };
  }

  function autoScroll() {
    if (!gesture?.started) return;
    const top = (document.querySelector('.editor-header')?.getBoundingClientRect().bottom || 0) + 55;
    const bottom = window.innerHeight - 65;
    const y = gesture.point.y;
    const speed = y < top ? -Math.min(14, (top - y) / 4) : y > bottom ? Math.min(14, (y - bottom) / 4) : 0;
    if (speed) {
      window.scrollBy(0, speed);
      if (gesture.kind === 'move') updateDrop();
      else updateSize();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function updateSize() {
    const { origin, point, box, module, frame, element, scope } = gesture;
    const gap = parseFloat(getComputedStyle(scope).columnGap) || 0;
    const width = scope.getBoundingClientRect().width;
    const layout = resizeModule(module.meta, module.override, box, { x: point.x - origin.x, y: point.y - origin.y + window.scrollY - gesture.scrollY }, width, gap);
    const meta = { ...normalizeLayout(module.meta), ...(layout?.span === undefined ? {} : { span: layout.span }) };
    const span = resolveLayoutSpan(meta, width, gap);
    element.dataset.resizeSpan = String(span);
    element.style.gridColumn = `span ${span}`;
    sizeModuleFrame(frame, meta, layout?.height);
    const label = element.querySelector('.layout-size');
    label.textContent = `${span}/12 · ${layout?.height === undefined ? '自动高度' : layout.height + 'px'}`;
    gesture.change = { kind: 'resize', id: gesture.id, layout };
  }

  function finish(cancel = false) {
    if (!gesture) return;
    const current = gesture;
    gesture = undefined;
    cancelAnimationFrame(scrollFrame);
    clearMarker(); ghost?.remove(); ghost = undefined;
    root.classList.remove('is-arranging');
    current.element.classList.remove('is-dragging', 'is-resizing');
    delete current.element.dataset.resizeSpan;
    if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
    if (current.started) {
      complete(cancel ? undefined : current.change);
    } else if (!cancel) select(current.id);
    focusHandle(current.id, current.action, current.scope.id);
  }

  root.addEventListener('pointerdown', event => {
    const handle = handleFor(event);
    if (!handle || event.button !== 0 || !event.isPrimary || gesture) return;
    const element = handle.closest('[data-module-id]');
    const kind = handle.dataset.layoutAction === 'resize' ? 'resize' : 'move';
    const frame = element.querySelector('.module-frame');
    event.preventDefault(); handle.focus({ preventScroll: true });
    gesture = { id: idOf(handle), action: handle.dataset.layoutAction, kind, element, frame, scope: element.parentElement, pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, point: { x: event.clientX, y: event.clientY }, scrollY: window.scrollY, box: frame?.getBoundingClientRect(), module: getModule(idOf(handle)), started: false };
    root.setPointerCapture(event.pointerId);
  }, { signal: listeners.signal });

  root.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.point = { x: event.clientX, y: event.clientY };
    if (!gesture.started) {
      if (Math.hypot(event.clientX - gesture.origin.x, event.clientY - gesture.origin.y) < 6) return;
      gesture.started = true;
      root.classList.add('is-arranging');
      gesture.element.classList.add(gesture.kind === 'move' ? 'is-dragging' : 'is-resizing');
      if (gesture.kind === 'move') {
        ghost = document.createElement('div'); ghost.className = 'layout-ghost';
        ghost.textContent = '⠿ ' + gesture.element.querySelector('[data-layout-action="move"]').dataset.label;
        document.body.append(ghost);
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    if (gesture.kind === 'resize') updateSize();
    else { ghost.style.transform = `translate(${Math.min(event.clientX + 14, window.innerWidth - ghost.offsetWidth - 8)}px, ${event.clientY + 14}px)`; updateDrop(); }
  }, { signal: listeners.signal });

  root.addEventListener('pointerup', event => { if (event.pointerId === gesture?.pointerId) finish(); }, { signal: listeners.signal });
  root.addEventListener('pointercancel', event => { if (event.pointerId === gesture?.pointerId) finish(true); }, { signal: listeners.signal });
  root.addEventListener('lostpointercapture', () => finish(true), { signal: listeners.signal });
  root.addEventListener('click', event => {
    const handle = handleFor(event);
    if (!handle) return;
    event.preventDefault();
    if (event.detail === 0 && handle.dataset.layoutAction === 'move') {
      const id = idOf(handle), scopeId = handle.closest('[data-module-id]').parentElement.id;
      select(id); focusHandle(id, 'move', scopeId);
    }
  }, { signal: listeners.signal });
  root.addEventListener('keydown', event => {
    const handle = handleFor(event);
    if (!handle || gesture) return;
    const id = idOf(handle);
    const action = handle.dataset.layoutAction;
    const scopeId = handle.closest('[data-module-id]').parentElement.id;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (handle.dataset.layoutAction === 'move') {
      const siblings = children(handle.closest('[data-module-id]').parentElement);
      const index = siblings.findIndex(element => element.dataset.moduleId === id);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? siblings.length - 1 : index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
      if (next < 0 || next >= siblings.length || next === index) return;
      complete({ kind: 'move', id, targetId: siblings[next].dataset.moduleId, after: next > index });
    } else {
      if (['Home', 'End'].includes(event.key)) return;
      const { meta, override } = getModule(id);
      const element = handle.closest('[data-module-id]');
      const layout = { ...override };
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) layout.span = Math.max(1, Math.min(12, (override?.span || normalizeLayout(meta).span) + (event.key === 'ArrowLeft' ? -1 : 1)));
      else layout.height = Math.max(120, Math.min(1600, Math.round(element.querySelector('.module-frame').getBoundingClientRect().height / 8) * 8 + (event.key === 'ArrowUp' ? -16 : 16)));
      complete({ kind: 'resize', id, layout });
    }
    focusHandle(id, action, scopeId);
  }, { signal: listeners.signal });
  window.addEventListener('keydown', event => { if (gesture && event.key === 'Escape') { event.preventDefault(); finish(true); } }, { signal: listeners.signal });
  window.addEventListener('blur', () => finish(true), { signal: listeners.signal });
  window.addEventListener('resize', () => finish(true), { signal: listeners.signal });
  return { get active() { return Boolean(gesture); }, destroy() { finish(true); listeners.abort(); } };
}
