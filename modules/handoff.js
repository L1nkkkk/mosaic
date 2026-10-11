// Lets a module hand an address to a browser module on the same page without either importing the other.
const ASK = 'mosaic:browser-available', OPEN = 'mosaic:browser-open';
const https = url => typeof url === 'string' && url.startsWith('https://') && url.length <= 4096;

// True while a browser module is mounted on this page.
export const browserAvailable = () => !dispatchEvent(new Event(ASK, { cancelable: true }));
export const openInBrowser = url => https(url) && !dispatchEvent(new CustomEvent(OPEN, { cancelable: true, detail: url }));

// Called by a browser module. With several on a page, the first one takes the address.
export function receiveAddresses(visit, signal) {
  addEventListener(ASK, event => event.preventDefault(), { signal });
  addEventListener(OPEN, event => { if (event.defaultPrevented || !https(event.detail)) return; event.preventDefault(); visit(event.detail); }, { signal });
}
