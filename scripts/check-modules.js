import { loadModules, initialPage, validatePage } from '../server/modules.js';
const registry = await loadModules(new URL('../modules', import.meta.url).pathname);
validatePage(initialPage(registry), registry);
console.log(`Module contracts verified: ${[...registry.keys()].join(', ')}`);
