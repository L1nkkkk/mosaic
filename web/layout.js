const COLUMNS = 12;

function objectWithKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}

function validSpan(value) { return Number.isInteger(value) && value >= 1 && value <= COLUMNS; }

// Shared by the server and browser. Old modules keep their original defaults.
export function normalizeLayout(input = 'half') {
  if (input === 'wide') input = { span: 12 };
  if (input === 'half') input = { span: 6 };
  if (!objectWithKeys(input, ['span', 'minWidth', 'aspectRatio'])) throw new Error('模块尺寸需要 span、minWidth 和可选的 aspectRatio。');
  const { span = 6, minWidth = 280, aspectRatio } = input;
  if (!validSpan(span)) throw new Error('模块占列数必须是 1 到 12 的整数。');
  if (typeof minWidth !== 'number' || !Number.isFinite(minWidth) || minWidth < 0 || minWidth > 4096) throw new Error('模块最小宽度必须是 0 到 4096 的像素数。');
  if (aspectRatio !== undefined && (typeof aspectRatio !== 'number' || !Number.isFinite(aspectRatio) || aspectRatio < 0.1 || aspectRatio > 10)) throw new Error('模块宽高比必须是 0.1 到 10 之间的数值。');
  return { span, minWidth, ...(aspectRatio === undefined ? {} : { aspectRatio }) };
}

// An instance may change its preferred width, never its module's constraints.
export function normalizeLayoutOverride(input) {
  if (input === undefined) return undefined;
  if (!objectWithKeys(input, ['span'])) throw new Error('页面模块尺寸只允许设置占列数。');
  if (input.span === undefined) return undefined;
  if (!validSpan(input.span)) throw new Error('模块占列数必须是 1 到 12 的整数。');
  return { span: input.span };
}

export function resolveLayoutSpan(layout, width, gap = 0) {
  const { span, minWidth } = normalizeLayout(layout);
  if (!Number.isFinite(width) || width <= 0) return COLUMNS;
  const spacing = Number.isFinite(gap) && gap >= 0 ? gap : 0;
  // Promote narrow cards to useful row fractions; half-width cards become full.
  const candidates = [span, ...[2, 3, 4, 6, 12].filter(value => value > span)];
  return candidates.find(value => (width + spacing) * value / COLUMNS - spacing >= minWidth) ?? COLUMNS;
}

export function observeModuleLayout(grid, slots) {
  const update = width => {
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    for (const { element, layout } of slots) {
      const span = String(resolveLayoutSpan(layout, width, gap));
      if (element.dataset.span !== span) {
        element.dataset.span = span;
        element.style.gridColumn = `span ${span}`;
      }
    }
  };
  update(grid.getBoundingClientRect().width);
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) if (entry.target === grid) update(entry.contentRect.width);
  });
  observer.observe(grid);
  return () => observer.disconnect();
}
