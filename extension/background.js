importScripts('core.js');
const { RULE_ID, matches, frameRules, relaxedCookie, knownDomain, responseCookie } = MosaicCore;

const prefix = async () => (await chrome.storage.sync.get('prefix')).prefix || '';
const domains = async () => (await chrome.storage.session.get('domains')).domains || [];
const store = details => chrome.cookies.set(details).catch(() => { /* The site keeps its own setting. */ });

// Responses are only observed in Mosaic tabs, so ordinary browsing never reaches this worker.
const watched = new Map();
function watch(tabIds) {
  for (const [tabId, listener] of watched) if (!tabIds.includes(tabId)) { chrome.webRequest.onHeadersReceived.removeListener(listener); watched.delete(tabId); }
  for (const tabId of tabIds) {
    if (watched.has(tabId)) continue;
    const listener = response => {
      if (response.frameId === 0) return;
      for (const header of response.responseHeaders || []) {
        if (header.name.toLowerCase() !== 'set-cookie') continue;
        for (const line of (header.value || '').split('\n')) { const cookie = responseCookie(line, response.url); if (cookie) store(cookie); }
      }
    };
    chrome.webRequest.onHeadersReceived.addListener(listener, { urls: ['https://*/*'], tabId }, ['responseHeaders', 'extraHeaders']);
    watched.set(tabId, listener);
  }
}

// Rule updates are serialized so a slow tab query cannot overwrite a newer result.
let pending = Promise.resolve();
function sync() {
  pending = pending.catch(() => {}).then(async () => {
    const mosaic = await prefix();
    const tabs = mosaic ? await chrome.tabs.query({}) : [];
    const tabIds = tabs.filter(tab => matches(tab.url, mosaic)).map(tab => tab.id);
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: frameRules(tabIds) });
    watch(tabIds);
  });
  return pending;
}

// Rewrites the cookies of one framed site and remembers the site for later cookie writes.
async function relax(url) {
  const known = new Set(await domains());
  known.add(new URL(url).hostname);
  let changed = 0;
  for (const cookie of await chrome.cookies.getAll({ url })) {
    known.add(cookie.domain);
    const next = relaxedCookie(cookie);
    if (!next) continue;
    try { await chrome.cookies.set(next); changed++; } catch { /* The site keeps its own setting. */ }
  }
  await chrome.storage.session.set({ domains: [...known] });
  return changed;
}

// Response listeners live in memory, so every start of the worker restores them.
sync();
chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url) sync(); });
chrome.tabs.onRemoved.addListener(sync);
chrome.tabs.onReplaced.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.prefix) sync(); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.cookies.onChanged.addListener(async ({ removed, cookie }) => {
  const next = removed ? null : relaxedCookie(cookie);
  if (next && knownDomain(cookie.domain, await domains())) store(next);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    const mosaic = await prefix();
    if (!sender.tab || !matches(sender.tab.url, mosaic)) return respond({});
    // The Mosaic page announces itself; its marker is only set once the frame rule is active.
    if (message?.type === 'hello' && sender.frameId === 0) { await sync(); return respond({ version: chrome.runtime.getManifest().version }); }
    if (message?.type === 'frame' && sender.frameId !== 0 && sender.url?.startsWith('https://')) return respond({ changed: await relax(sender.url) });
    respond({});
  })().catch(() => respond({}));
  return true;
});
