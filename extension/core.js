// Classic script shared by the service worker, the content scripts and the Node tests.
(() => {
  const RULE_ID = 1;

  // The configured Mosaic address: an origin plus an optional path prefix such as /mosaic.
  function parsePrefix(value) {
    try {
      const url = new URL(String(value ?? '').trim());
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      return { origin: url.origin, path: url.pathname.replace(/\/+$/, '') };
    } catch { return null; }
  }

  function matches(address, prefix) {
    const mosaic = parsePrefix(prefix);
    if (!mosaic) return false;
    let url;
    try { url = new URL(address); } catch { return false; }
    return url.origin === mosaic.origin && (url.pathname === mosaic.path || url.pathname.startsWith(`${mosaic.path}/`));
  }

  // Only subframes of the listed tabs lose their framing restrictions; every other tab keeps them.
  function frameRules(tabIds) {
    if (!tabIds.length) return [];
    return [{
      id: RULE_ID, priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] },
      condition: { tabIds, resourceTypes: ['sub_frame'] },
    }];
  }

  // A cookie that Chrome withholds from a cross-site frame, rewritten so the frame receives it.
  function relaxedCookie(cookie) {
    if (!['unspecified', 'lax'].includes(cookie.sameSite)) return null;
    const details = {
      url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`, name: cookie.name, value: cookie.value, path: cookie.path,
      secure: true, httpOnly: cookie.httpOnly, sameSite: 'no_restriction', storeId: cookie.storeId,
    };
    if (!cookie.hostOnly) details.domain = cookie.domain;
    if (!cookie.session) details.expirationDate = cookie.expirationDate;
    if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
    return details;
  }

  // Whether a cookie domain belongs to a site that was opened inside the module.
  function knownDomain(domain, known) {
    const bare = String(domain).replace(/^\./, '');
    return known.some(entry => { const other = entry.replace(/^\./, ''); return bare === other || bare.endsWith(`.${other}`) || (bare.includes('.') && other.endsWith(`.${bare}`)); });
  }

  // Chrome drops a cookie that a cross-site frame's response sets without SameSite=None.
  // Returns that Set-Cookie header as chrome.cookies.set details, or null when Chrome already handles it.
  function responseCookie(header, address, now = Date.now()) {
    const [pair, ...attributes] = String(header).split(';');
    const at = pair.indexOf('=');
    let url;
    try { url = new URL(address); } catch { return null; }
    if (at < 1 || url.protocol !== 'https:') return null;
    const details = { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), path: url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/', secure: true, sameSite: 'no_restriction' };
    let expires, maxAge;
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split('=');
      const name = key.trim().toLowerCase(), value = rest.join('=').trim();
      if (name === 'domain' && value) details.domain = value.startsWith('.') ? value : `.${value}`;
      else if (name === 'path' && value.startsWith('/')) details.path = value;
      else if (name === 'httponly') details.httpOnly = true;
      else if (name === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
      else if (name === 'expires' && !Number.isNaN(Date.parse(value))) expires = Date.parse(value) / 1000;
      // SameSite=None and partitioned cookies are stored by Chrome itself; Strict is the site's explicit choice.
      else if (name === 'partitioned' || (name === 'samesite' && ['none', 'strict'].includes(value.toLowerCase()))) return null;
    }
    if (maxAge !== undefined) details.expirationDate = now / 1000 + maxAge; else if (expires !== undefined) details.expirationDate = expires;
    details.url = `${url.origin}${details.path}`;
    return details;
  }

  globalThis.MosaicCore = { RULE_ID, parsePrefix, matches, frameRules, relaxedCookie, knownDomain, responseCookie };
})();
