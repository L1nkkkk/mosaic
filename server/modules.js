import { readdir, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeLayout, normalizeLayoutOverride } from '../web/layout.js';
import { spacesOf, placedModules } from '../web/spaces.js';

export async function loadModules(directory) {
  const registry = new Map();
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9-]*$/.test(entry.name)) continue;
    const files = await readdir(path.join(directory, entry.name));
    const split = files.includes('definition.js');
    if (split) await access(path.join(directory, entry.name, 'client.js'));
    const module = await import(pathToFileURL(path.join(directory, entry.name, split ? 'definition.js' : 'index.js')));
    if (module.meta?.id !== entry.name || typeof module.validate !== 'function' || (!split && (typeof module.render !== 'function' || typeof module.edit !== 'function'))) {
      throw new Error(`Invalid module contract: ${entry.name}`);
    }
    module.validate(structuredClone(module.meta.defaultData));
    if (module.meta.animation !== undefined && !['continuous', 'demand'].includes(module.meta.animation)) throw new Error(`Invalid animation: ${entry.name}`);
    if (module.meta.isolation !== undefined && !['light', 'shadow'].includes(module.meta.isolation)) throw new Error(`Invalid isolation: ${entry.name}`);
    let layout;
    try { layout = normalizeLayout(module.meta.layout); }
    catch (error) { throw new Error(`Invalid module layout (${entry.name}): ${error.message}`); }
    registry.set(entry.name, { ...module, entry: split ? 'client.js' : 'index.js', meta: { ...module.meta, layout } });
  }
  if (!registry.size) throw new Error('At least one module is required');
  return registry;
}

export function validatePage(input, registry) {
  if (input?.spaces !== undefined) return validateSpaces(input, registry);
  if (!input || typeof input !== 'object' || !Array.isArray(input.modules) || input.modules.length > 30) throw new Error('页面最多可放置 30 个模块。');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) throw new Error('空间名称需要填写，最多 80 个字。');
  const seen = new Set();
  const modules = input.modules.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id)) throw new Error('模块编号无效或重复。');
    seen.add(item.id);
    const module = registry.get(item.type);
    if (!module) throw new Error('页面包含当前版本不支持的模块。');
    // Older content had no audience field and was already publicly published.
    const audience = item.audience ?? (module.meta.privateOnly ? 'private' : 'public');
    if (!['public', 'private'].includes(audience)) throw new Error('请选择 Public 或 Private。');
    if (module.meta.privateOnly && audience !== 'private') throw new Error(`${module.meta.name}只能在私人页显示。`);
    const layout = normalizeLayoutOverride(item.layout);
    if (item.appearance !== undefined && !['card', 'bare'].includes(item.appearance)) throw new Error('模块外观无效。');
    // Keep the legacy flag restrictive so older readers cannot expose private data.
    return { id: item.id, type: item.type, audience, visible: audience === 'public' && item.visible !== false, ...(layout ? { layout } : {}), ...(item.appearance ? { appearance: item.appearance } : {}), ...(item.live === true ? { live: true } : {}), data: module.validate(item.data) };
  });
  if (input.flow !== undefined && !['grid', 'masonry'].includes(input.flow)) throw new Error('页面排列方式无效。');
  return { title: input.title.trim(), ...(input.flow ? { flow: input.flow } : {}), modules };
}

// A page with its own arrangement per space. Module-level audience, size and
// appearance are then derived, so a reader without spaces stays restrictive.
function validateSpaces(input, registry) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.modules)) throw new Error('页面最多可放置 30 个模块。');
  const spaces = input.spaces;
  if (!spaces || typeof spaces !== 'object' || Object.keys(spaces).sort().join() !== 'private,public') throw new Error('页面空间无效。');
  const types = new Map(input.modules.map(item => [item?.id, item?.type]));
  const pages = validatePages(input.pages);
  const result = {};
  for (const name of ['public', 'private']) {
    const space = spaces[name];
    if (!space || typeof space !== 'object' || !Array.isArray(space.items) || space.items.length > 30) throw new Error('页面空间无效。');
    if (space.flow !== undefined && !['grid', 'masonry'].includes(space.flow)) throw new Error('页面排列方式无效。');
    const seen = new Set();
    const items = space.items.map(entry => {
      if (!entry || typeof entry.id !== 'string' || !types.has(entry.id) || seen.has(entry.id)) throw new Error('模块编号无效或重复。');
      seen.add(entry.id);
      const module = registry.get(types.get(entry.id));
      if (name === 'public' && module?.meta.privateOnly) throw new Error(`${module.meta.name}只能在私人页显示。`);
      const layout = normalizeLayoutOverride(entry.layout);
      if (entry.appearance !== undefined && !['card', 'bare'].includes(entry.appearance)) throw new Error('模块外观无效。');
      // The first page is the default, so only the others are written down.
      const elsewhere = name === 'private' && entry.page !== undefined && entry.page !== pages[0]?.id;
      if (elsewhere && !pages.slice(1).some(page => page.id === entry.page)) throw new Error('模块所在的页面不存在。');
      return { id: entry.id, ...(layout ? { layout } : {}), ...(entry.appearance ? { appearance: entry.appearance } : {}), ...(elsewhere && pages.length > 1 ? { page: entry.page } : {}) };
    });
    // A reader without pages shows all of Private at once, arranged like the first page.
    const flow = name === 'private' && pages.length ? pages[0].flow : space.flow;
    result[name] = { ...(flow ? { flow } : {}), items };
  }
  const shown = { public: new Map(result.public.items.map(entry => [entry.id, entry])), private: new Map(result.private.items.map(entry => [entry.id, entry])) };
  for (const item of input.modules) {
    if (!shown.public.has(item.id) && !shown.private.has(item.id)) throw new Error('模块需要至少放在一个空间。');
    // An editor opened before this page had spaces must not appear to revoke a module it cannot revoke.
    if (item.audience === 'private' && shown.public.has(item.id)) throw new Error('页面已更新，请重新载入编辑台后再保存。');
  }
  const order = [...result.private.items, ...result.public.items.filter(entry => !shown.private.has(entry.id))].map(entry => entry.id);
  const byId = new Map(input.modules.map(item => [item.id, item]));
  const mirrored = order.map(id => {
    const item = byId.get(id), open = shown.public.has(id), entry = shown.public.get(id) || shown.private.get(id);
    return { id, type: item.type, audience: open ? 'public' : 'private', visible: open, layout: entry.layout, appearance: entry.appearance, live: item.live, data: item.data };
  });
  const legacy = validatePage({ title: input.title, flow: result.public.flow, modules: mirrored }, registry);
  // Identical arrangements need no spaces; such pages keep the original shape.
  const same = result.public.flow === result.private.flow && result.private.items.length === order.length
    && JSON.stringify(result.public.items) === JSON.stringify(result.private.items.filter(entry => shown.public.has(entry.id)));
  if (pages.length > 1) return { ...legacy, spaces: result, pages };
  return same ? legacy : { ...legacy, spaces: result };
}

// Private pages: an ordered list of tabs. Fewer than two means no tabs, which is not stored.
function validatePages(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 12) throw new Error('私人空间最多分成 12 个页面。');
  const seen = new Set();
  return input.map(page => {
    if (!page || typeof page.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,23}$/.test(page.id) || seen.has(page.id)) throw new Error('页面地址只能用小写字母、数字和连字符，且不能重复。');
    seen.add(page.id);
    if (typeof page.title !== 'string' || !page.title.trim() || page.title.length > 24) throw new Error('页面名称需要填写，最多 24 个字。');
    if (page.flow !== undefined && !['grid', 'masonry'].includes(page.flow)) throw new Error('页面排列方式无效。');
    return { id: page.id, title: page.title.trim(), ...(page.flow ? { flow: page.flow } : {}) };
  });
}

export function initialPage(registry) {
  return {
    title: 'Mosaic · 拼页',
    modules: [...registry.values()].map(module => ({ id: `welcome-${module.meta.id}`, type: module.meta.id, audience: module.meta.privateOnly ? 'private' : 'public', visible: !module.meta.privateOnly, data: structuredClone(module.meta.defaultData) })),
  };
}

// What visitors receive: the Public arrangement, with each module reduced to
// the fields it chooses to show.
export function publicPage(page, registry) {
  const normalized = validatePage(page, registry);
  const flow = spacesOf(normalized).public.flow;
  const modules = placedModules(normalized, 'public').map(({ live, ...item }) => {
    const reduce = registry.get(item.type).publicData;
    return { ...item, audience: 'public', visible: true, data: reduce ? reduce(structuredClone(item.data)) : item.data };
  });
  return { title: normalized.title, ...(flow ? { flow } : {}), modules };
}

function withdraw(page, ids) {
  const next = { ...page, modules: page.modules.map(module => ids.has(module.id) ? { ...module, audience: 'private', visible: false } : module) };
  if (page.spaces) next.spaces = { ...page.spaces, public: { ...page.spaces.public, items: page.spaces.public.items.filter(entry => !ids.has(entry.id)) } };
  return next;
}

// Live modules skip the publish step for their content only; whether and where
// a module appears in Public still changes through publishing.
export function syncLive(state) {
  const open = new Set(spacesOf(state.published).public.items.map(entry => entry.id));
  const live = new Map(state.draft.modules.filter(module => module.live && open.has(module.id) && spacesOf(state.draft).public.items.some(entry => entry.id === module.id)).map(module => [module.id, module]));
  if (!live.size) return state;
  return { ...state, published: { ...state.published, modules: state.published.modules.map(module => live.get(module.id)?.type === module.type ? { ...module, live: true, data: structuredClone(live.get(module.id).data) } : module) } };
}

export function savePageDraft(state, page) {
  // Leaving Public takes effect at once; a hidden legacy module waits for publishing as before.
  const open = new Set(spacesOf(page).public.items.map(entry => entry.id));
  const restricted = new Set(page.modules.filter(module => page.spaces ? !open.has(module.id) : module.audience === 'private').map(module => module.id));
  return syncLive({ ...state, draft: page, published: withdraw(state.published, restricted) });
}
