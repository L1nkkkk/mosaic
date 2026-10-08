import { readdir, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeLayout, normalizeLayoutOverride } from '../web/layout.js';

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
    return { id: item.id, type: item.type, audience, visible: audience === 'public' && item.visible !== false, ...(layout ? { layout } : {}), ...(item.appearance ? { appearance: item.appearance } : {}), data: module.validate(item.data) };
  });
  if (input.flow !== undefined && !['grid', 'masonry'].includes(input.flow)) throw new Error('页面排列方式无效。');
  return { title: input.title.trim(), ...(input.flow ? { flow: input.flow } : {}), modules };
}

export function initialPage(registry) {
  return {
    title: 'Mosaic · 拼页',
    modules: [...registry.values()].map(module => ({ id: `welcome-${module.meta.id}`, type: module.meta.id, audience: module.meta.privateOnly ? 'private' : 'public', visible: !module.meta.privateOnly, data: structuredClone(module.meta.defaultData) })),
  };
}

export function publicPage(page, registry) {
  const normalized = validatePage(page, registry);
  return { ...normalized, modules: normalized.modules.filter(module => module.audience === 'public' && module.visible) };
}

export function savePageDraft(state, page) {
  const restricted = new Set(page.modules.filter(module => module.audience === 'private').map(module => module.id));
  return { ...state, draft: page, published: { ...state.published, modules: state.published.modules.map(module => restricted.has(module.id) ? { ...module, audience: 'private', visible: false } : module) } };
}
