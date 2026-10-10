import { loadModules, initialPage, validatePage } from '../server/modules.js';
import { fileURLToPath } from 'node:url';
import { readdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const directory = fileURLToPath(new URL('../modules', import.meta.url));
const registry = await loadModules(directory);
validatePage(initialPage(registry), registry);
for (const module of registry.values()) await access(path.join(directory, module.meta.id, 'style.css'));
// Parse client code without executing its DOM/WebGL imports inside Node.
for (const base of [directory, fileURLToPath(new URL('../web', import.meta.url)), fileURLToPath(new URL('../extension', import.meta.url))]) {
  for (const filename of await readdir(base, { recursive: true })) if (filename.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(base, filename)], { stdio: 'pipe' });
}
console.log(`Module definitions, styles and JS syntax verified: ${[...registry.keys()].join(', ')}`);
