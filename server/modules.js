import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadModules(directory) {
  const registry = new Map();
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9-]*$/.test(entry.name)) continue;
    const module = await import(pathToFileURL(path.join(directory, entry.name, 'index.js')));
    if (module.meta?.id !== entry.name || typeof module.validate !== 'function' || typeof module.render !== 'function' || typeof module.edit !== 'function') {
      throw new Error(`Invalid module contract: ${entry.name}`);
    }
    module.validate(structuredClone(module.meta.defaultData));
    registry.set(entry.name, module);
  }
  if (!registry.size) throw new Error('At least one module is required');
  return registry;
}

export function validatePage(input, registry) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.modules) || input.modules.length > 30) throw new Error('页面最多可放置 30 个模块。');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) throw new Error('空间名称需要填写，最多 80 个字。');
  const seen = new Set();
  const modules = input.modules.map(item => {
    if (!item || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id)) throw new Error('模块编号无效或重复。');
    seen.add(item.id);
    const module = registry.get(item.type);
    if (!module) throw new Error('页面包含当前版本不支持的模块。');
    return { id: item.id, type: item.type, visible: item.visible !== false, data: module.validate(item.data) };
  });
  return { title: input.title.trim(), modules };
}

export function initialPage(registry) {
  return {
    title: 'Mosaic · 拼页',
    modules: [...registry.values()].map(module => ({ id: `welcome-${module.meta.id}`, type: module.meta.id, visible: true, data: structuredClone(module.meta.defaultData) })),
  };
}
