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

// The same for tasks: a module asks a writable todo module on the page to add one.
const TODO_ASK = 'mosaic:todo-available', TODO_ADD = 'mosaic:todo-add';
const task = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
export const todoAvailable = () => !dispatchEvent(new Event(TODO_ASK, { cancelable: true }));
// False when no todo module took the task, for example because it is still saving.
export const addTodo = value => task(value) && !dispatchEvent(new CustomEvent(TODO_ADD, { cancelable: true, detail: value }));

// Called by a todo module; `add` returns whether it accepted the task.
export function receiveTodos(add, signal) {
  addEventListener(TODO_ASK, event => event.preventDefault(), { signal });
  addEventListener(TODO_ADD, event => { if (!event.defaultPrevented && task(event.detail) && add(event.detail.trim())) event.preventDefault(); }, { signal });
}
