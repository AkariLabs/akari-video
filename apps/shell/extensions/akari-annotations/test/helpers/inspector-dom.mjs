// Small DOM double for inspector factories, matching the extension's existing test style.
export class InspectorElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = {};
        this.disabled = false;
        this.isConnected = true;
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(fn => fn !== listener));
    }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
        this.isConnected = false;
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    emit(type, event = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener({ preventDefault() {}, ...event });
    }
    showPopover() { this.open = true; }
    focus() { this.focused = true; }
    getBoundingClientRect() { return { right: 240, bottom: 100, width: 200, height: 36 }; }
}

export function withInspectorDom(callback) {
    const observers = [];
    const document = new InspectorElement('document');
    document.body = new InspectorElement('body');
    document.createElement = tag => new InspectorElement(tag);
    const window = Object.assign(new InspectorElement('window'), { innerWidth: 240, innerHeight: 320 });
    const globals = { document, window, MutationObserver: class {
        constructor(fn) { this.callback = fn; observers.push(this); }
        observe() { this.observing = true; }
        disconnect() { this.observing = false; }
    } };
    const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const restore = () => {
        for (const [key, original] of originals) {
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        }
    };
    try {
        const result = callback({ document, window, observers });
        if (result instanceof Promise) return result.finally(restore);
        restore();
        return result;
    } catch (error) { restore(); throw error; }
}
