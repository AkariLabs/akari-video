// Browser registry bootstrap. Kept inline in overlay-runtime.js for script-only hosts.
window.akari = window.akari || {};
(() => {
  if (window.akari.runtimes) return;
  const entries = new Map();
  window.akari.runtimes = {
    register(entry) {
      if (!entry || typeof entry.id !== "string" || !entry.id || typeof entry.selector !== "string" ||
          ["render", "inspect", "dispose"].some(key => typeof entry[key] !== "function")) {
        throw new TypeError("runtime requires id, selector, render, inspect and dispose");
      }
      entries.set(entry.id, Object.freeze({ ...entry }));
    },
    list() { return [...entries.values()]; },
    forContainer(container) { return this.list().filter(entry => container.querySelector(entry.selector)); },
  };
  for (const entry of window.akari.pendingRuntimes ?? []) window.akari.runtimes.register(entry);
  window.akari.pendingRuntimes = [];
})();
