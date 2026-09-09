import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const rect = (left = 0, top = 0, width = 100, height = 100) =>
  ({ left, top, width, height, right: left + width, bottom: top + height });
class Element {
  constructor(tag = 'DIV', bounds = rect(), children = [], css = {}) {
    this.tagName = tag; this.bounds = bounds; this.children = children;
    this.childNodes = children; this.attributes = {}; this.dataset = {};
    this.css = { display: 'block', opacity: '1', visibility: 'visible', ...css };
    this.properties = new Map();
    this.style = {
      getPropertyValue: key => this.properties.get(key)?.value ?? '',
      getPropertyPriority: key => this.properties.get(key)?.priority ?? '',
      setProperty: (key, value, priority) => this.properties.set(key, { value, priority }),
    };
    for (const child of children) child.parentElement = this;
  }
  getBoundingClientRect() { return this.bounds; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return name in this.attributes; }
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  contains(element) { return this === element || this.querySelectorAll().includes(element); }
  closest(selector) {
    const name = selector.slice(1, -1);
    return this.hasAttribute(name) ? this : this.parentElement?.closest(selector) ?? null;
  }
}
const text = (bounds, css) => {
  const el = new Element('SPAN', bounds, [], css);
  el.childNodes = [{ nodeType: 3, textContent: 'Title' }];
  return el;
};
function boot() {
  const listeners = new Map();
  let sampleAlpha = 255, drawError = false;
  const samples = [];
  const document = {
    getElementById: () => null, addEventListener() {},
    createElement: () => ({ width: 0, height: 0, getContext: () => ({
      clearRect() {},
      drawImage(...args) { if (drawError) throw new Error('tainted'); samples.push(args); },
      getImageData: () => ({ data: [0, 0, 0, sampleAlpha] }),
    }) }),
  };
  const window = { addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  } };
  const context = { window, document, Element, HTMLElement: Element,
    Node: { TEXT_NODE: 3 }, getComputedStyle: el => el.css,
    PointerEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
    MouseEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
  };
  vm.runInNewContext(source('interaction.js'), context);
  return { api: window.akari.interaction, window, context, document, listeners, samples,
    setAlpha: value => { sampleAlpha = value; }, failRead: () => { drawError = true; } };
}

test('DOM union shrinks nested full-frame positioning wrappers to visible text', () => {
  const { api } = boot();
  const title = text(rect(35, 40, 30, 20));
  const nested = new Element('DIV', rect(), [title]);
  const root = new Element('DIV', rect(), [nested]);
  const container = new Element('DIV', rect(), [root]);
  assert.deepEqual({ ...api.fragmentBounds(container) }, title.bounds);
});

test('hidden descendants do not trigger shrinking; visible descendants override inherited hidden visibility', () => {
  const { api } = boot();
  for (const css of [{ opacity: '0' }, { display: 'none' }, { visibility: 'hidden' }]) {
    const root = new Element('DIV', rect(), [text(rect(35, 40, 30, 20), css)]);
    assert.deepEqual({ ...api.fragmentBounds(new Element('DIV', rect(), [root])) }, rect());
  }
  const title = text(rect(35, 40, 30, 20));
  const hidden = new Element('DIV', rect(), [title], { opacity: '0' });
  const root = new Element('DIV', rect(), [hidden]);
  assert.deepEqual({ ...api.fragmentBounds(new Element('DIV', rect(), [root])) }, rect());
});

test('backdrop, transition, still and painted full-frame children retain their bounds and hit policy', () => {
  const { api } = boot();
  for (const tag of ['DIV', 'IMG', 'VIDEO']) {
    const full = new Element(tag, rect(), [], tag === 'DIV' ? { backgroundColor: 'rgb(0,0,0)' } : {});
    const root = new Element('DIV', rect(), [full, text(rect(35, 40, 30, 20))]);
    const container = new Element('DIV', rect(), [root]);
    assert.deepEqual({ ...api.fragmentBounds(container) }, rect());
    api.applyOverlayHitPolicy(container);
    assert.equal(full.style.getPropertyValue('pointer-events'), 'auto');
    assert.equal(root.style.getPropertyValue('pointer-events'), 'none');
  }
  const root = new Element('DIV', rect(), [], { backgroundColor: 'black' });
  const container = new Element('DIV', rect(), [root]);
  api.applyOverlayHitPolicy(container);
  assert.equal(root.style.getPropertyValue('pointer-events'), 'none', 'root hit exception is unchanged');
  assert.deepEqual({ ...api.fragmentBounds(container) }, rect());
});

function canvas() {
  const el = new Element('CANVAS', rect(10, 20, 100, 50));
  el.width = 1000; el.height = 500;
  el.getContext = name => name === '2d' ? {} : null;
  return el;
}
test('canvas alpha uses backing-pixel coordinates and unreadable/tainted/unsaved WebGL falls back opaque', () => {
  const h = boot(), el = canvas();
  h.setAlpha(0);
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 0);
  assert.deepEqual(h.samples.at(-1).slice(1), [500, 250, 1, 1, 0, 0, 1, 1]);
  h.setAlpha(255);
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 255);
  assert.equal(h.api.canvasAlphaAtPoint(el, 110, 45), 0);
  el.getContext = () => null;
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 255);
  el.getContext = name => name === '2d' ? null : {
    isContextLost: () => false, getContextAttributes: () => ({ preserveDrawingBuffer: false }),
  };
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 255);
  h.api.captureCanvasContent(el);
  h.setAlpha(0);
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 0, 'draw-time copy survives WebGL buffer discard');
  h.failRead();
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 255);
});

test('CSS canvas backgrounds stay opaque and explicit catch/pass override alpha retargeting', () => {
  for (const directive of ['catch', 'pass']) {
    const h = boot(), el = canvas();
    const root = new Element('DIV', rect(), [el]);
    root.attributes['data-akari-hit'] = directive;
    h.api.applyOverlayHitPolicy(new Element('DIV', rect(), [root]));
    assert.equal(el.style.getPropertyValue('pointer-events'), directive === 'catch' ? 'auto' : 'none');
    h.setAlpha(0);
    h.listeners.get('pointerdown')[0]({ target: el });
  }
  const h = boot(), el = canvas();
  el.css.backgroundColor = 'black'; h.setAlpha(0);
  assert.equal(h.api.canvasAlphaAtPoint(el, 60, 45), 255);
});

test('transparent pointerdown/click pass stacked canvases to underlying media and restore hit styles', () => {
  const h = boot(), upper = canvas(), lower = canvas();
  const root = new Element('DIV', rect(), [upper, lower]);
  h.api.applyOverlayHitPolicy(new Element('DIV', rect(), [root]));
  h.setAlpha(0);
  const received = [];
  const media = { dispatchEvent: event => { received.push(event); } };
  h.document.elementFromPoint = () => lower.style.getPropertyValue('pointer-events') === 'auto' ? lower : media;
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
    let stopped = false;
    h.listeners.get(type)[0]({ type, target: upper, clientX: 60, clientY: 45,
      pointerId: 3, button: 0, shiftKey: true, bubbles: true, cancelable: true,
      stopImmediatePropagation: () => { stopped = true; }, preventDefault() {} });
    assert.ok(stopped);
    assert.equal(received.at(-1).type, type);
    assert.equal(received.at(-1).pointerId, 3);
    assert.equal(received.at(-1).shiftKey, true);
    assert.equal(upper.style.getPropertyValue('pointer-events'), 'auto');
    assert.equal(lower.style.getPropertyValue('pointer-events'), 'auto');
  }
});

test('fragment bounds prefer a live 3D content declaration over the full canvas', () => {
  const h = boot(), el = canvas(), declared = rect(35, 40, 30, 20);
  const root = new Element('DIV', rect(), [el]);
  h.window.akari.threeRuntime = { contentBounds: () => declared };
  assert.deepEqual({ ...h.api.fragmentBounds(new Element('DIV', rect(), [root])) }, declared);
});

test('3D projection follows text/mesh transforms and camera, excludes hidden content, clips near plane safely', () => {
  const h = boot();
  vm.runInNewContext(source('vendor/three-bundle.js'), h.context);
  vm.runInNewContext(source('three-runtime.js'), h.context);
  const { THREE } = h.window.AkariThree;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.z = 5;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), new THREE.MeshBasicMaterial());
  scene.add(mesh);
  const project = () => h.window.akari.threeRuntime.projectContentBounds(scene, camera);
  const initial = project();
  assert.ok(initial.left > 0 && initial.right < 1 && initial.top > 0 && initial.bottom < 1);
  mesh.position.x = 1;
  assert.ok(project().left > initial.left);
  const hidden = new THREE.Group();
  hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(100, 100, 1), new THREE.MeshBasicMaterial()));
  scene.add(hidden);
  assert.ok(project().left > initial.left);
  mesh.scale.x = 2;
  const scaled = project();
  assert.ok(scaled.right - scaled.left > initial.right - initial.left);
  camera.setViewOffset(200, 100, 20, 0, 200, 100);
  assert.ok(project().left < scaled.left);
  mesh.position.z = 5;
  assert.deepEqual({ ...project() }, { left: 0, top: 0, right: 1, bottom: 1 });
  mesh.position.z = 10;
  assert.equal(project(), null);
});
