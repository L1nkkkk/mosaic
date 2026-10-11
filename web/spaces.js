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

// Private can be split into tabbed pages. Each private module sits on exactly
// one of them; a page saved without any has this single one.
export const MAIN_PAGE = { id: 'main', title: '总览' };
export function pagesOf(page) {
  if (page.pages?.length) return structuredClone(page.pages);
  return [{ ...MAIN_PAGE, ...(spacesOf(page).private.flow ? { flow: spacesOf(page).private.flow } : {}) }];
}
// A placement without a known page belongs to the first one.
export const pageOfEntry = (pages, entry) => pages.some(item => item.id === entry.page) ? entry.page : pages[0].id;

// Modules as one space shows them, carrying that space's size and appearance.
// `pageId` narrows Private to one of its pages.
export function placedModules(page, space, pageId) {
  const modules = new Map(page.modules.map(item => [item.id, item])), pages = pagesOf(page);
  return spacesOf(page)[space].items.filter(entry => modules.has(entry.id) && (space !== 'private' || pageId === undefined || pageOfEntry(pages, entry) === pageId)).map(entry => {
    const { layout, appearance, ...item } = modules.get(entry.id);
    return { ...item, ...(entry.layout ? { layout: entry.layout } : {}), ...(entry.appearance ? { appearance: entry.appearance } : {}) };
  });
}

export function inSpace(page, space, id) { return spacesOf(page)[space].items.some(entry => entry.id === id); }
