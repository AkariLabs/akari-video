// Test-only runtime: authored time determines the solid canvas color.
(() => {
  const instances = new WeakMap();
  const entry = {
    id: "dummy", selector: 'script[type="application/json"][data-akari-dummy-scene]',
    render(container, seconds, options = {}) {
      let canvas = instances.get(container)?.canvas;
      if (!canvas) {
        canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
        container.appendChild(canvas);
      }
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = seconds < 1 ? "#ff0000" : "#0000ff";
      ctx.fillRect(0, 0, 16, 16);
      instances.set(container, {canvas, seconds, options});
    },
    inspect(container) {
      const instance = instances.get(container);
      return instance ? {status:"ready", seconds:instance.seconds, options:instance.options} : {status:"idle"};
    },
    dispose(container) { instances.get(container)?.canvas.remove(); instances.delete(container); },
  };
  window.akari = window.akari || {};
  window.akari.dummyRuntime = entry;
  if (window.akari.runtimes) window.akari.runtimes.register(entry);
  else (window.akari.pendingRuntimes ??= []).push(entry);
})();
