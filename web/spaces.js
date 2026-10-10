// Shared by the server and browser. A page keeps one list of module instances;
// each space decides which of them it shows, in what order and at what size.
export const SPACES = ['public', 'private'];

const placement = item => ({ id: item.id, ...(item.layout ? { layout: item.layout } : {}), ...(item.appearance ? { appearance: item.appearance } : {}) });

// Pages saved before spaces existed show everything in Private and the
// visible Public modules in Public, with one shared order and size.
export function spacesOf(page) {
  if (page.spaces) return structuredClone(page.spaces);
  const flow = page.flow ? { flow: page.flow } : {};
  return {
    public: { ...flow, items: page.modules.filter(item => item.audience !== 'private' && item.visible !== false).map(placement) },
    private: { ...flow, items: page.modules.map(placement) },
  };
}

// Modules as one space shows them, carrying that space's size and appearance.
export function placedModules(page, space) {
  const modules = new Map(page.modules.map(item => [item.id, item]));
  return spacesOf(page)[space].items.filter(entry => modules.has(entry.id)).map(entry => {
    const { layout, appearance, ...item } = modules.get(entry.id);
    return { ...item, ...(entry.layout ? { layout: entry.layout } : {}), ...(entry.appearance ? { appearance: entry.appearance } : {}) };
  });
}

export function inSpace(page, space, id) { return spacesOf(page)[space].items.some(entry => entry.id === id); }
