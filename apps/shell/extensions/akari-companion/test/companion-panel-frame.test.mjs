import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadSource(relative, overrides = {}) {
  const filename = new URL(`../src/${relative}`, import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require, module, exports) { ${output}\n})`, { filename: filename.pathname })(
    id => overrides[id] ?? require(id), module, module.exports);
  return module.exports;
}
const geometry = loadSource('common/companion-panel-geometry.ts');
const { CompanionPanelFrame } = loadSource('browser/companion-panel-frame.ts', {
  '../common/companion-panel-geometry': geometry
});
const storageKey = 'akari.companion.panel.placement';

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    if (tagName === 'iframe') {
      this.messages = [];
      this.contentWindow = { postMessage: (...args) => this.messages.push(args) };
    }
  }
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = undefined;
  }
  get isConnected() { return Boolean(this.parent); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function fixture() {
  const values = new Map();
  const doc = {
    body: new Element('body'),
    createElement: tag => new Element(tag),
    activeElement: null
  };
  const listeners = new Map();
  const win = {
    innerWidth: 1200,
    innerHeight: 800,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? new Set();
      list.add(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    setInterval: () => 1,
    clearInterval() {}
  };
  const frame = new CompanionPanelFrame({ doc, win });
  const mount = (width = 620) => frame.mount('/panel', 1234, { width, height: 200 });
  const message = data => win.dispatch('message', { source: frame.iframeEl.contentWindow, data });
  return { frame, win, values, mount, message };
}

function mouse(clientX, buttons = 1) {
  return { button: 0, buttons, clientX, screenX: clientX, screenY: 100,
    preventDefault() {}, stopPropagation() {} };
}

test('左ボタンを離した mousemove で枠を動かさずドラッグを終える', () => {
  const { frame, win, mount, message } = fixture();
  mount();
  message({ type: 'akari-companion-panel', drag: { phase: 'start' } });
  win.dispatch('mousemove', mouse(100));
  const left = frame.panelEl.style.left;
  win.dispatch('mousemove', mouse(180, 0));
  assert.equal(frame.panelEl.style.left, left);
  assert.equal(frame.dragSurface, undefined);
  win.dispatch('mousemove', mouse(240));
  assert.equal(frame.panelEl.style.left, left);
  frame.unmount();
});

test('中身の drag end と window blur でドラッグを終える', () => {
  const { frame, win, mount, message } = fixture();
  mount();
  message({ type: 'akari-companion-panel', drag: { phase: 'start' } });
  win.dispatch('mousemove', mouse(100));
  const left = frame.panelEl.style.left;
  message({ type: 'akari-companion-panel', drag: { phase: 'end', dx: 200, dy: 0 } });
  assert.equal(frame.dragSurface, undefined);
  assert.equal(frame.panelEl.style.left, left);
  message({ type: 'akari-companion-panel', drag: { phase: 'start' } });
  win.dispatch('blur');
  assert.equal(frame.dragSurface, undefined);
  frame.unmount();
});

test('左下のつまみは幅を丸めて保存し次の mount と iframe へ渡す', () => {
  const { frame, win, values, mount, message } = fixture();
  frame.setAnchorProvider(() => ({ left: 900, right: 940, bottom: 40 }));
  mount();
  const firstIframe = frame.iframeEl;
  assert.deepEqual(firstIframe.messages.at(-1), [{ type: 'akari-companion-frame', width: 620 }, '*']);
  firstIframe.dispatch('load');
  assert.deepEqual(firstIframe.messages.at(-1), [{ type: 'akari-companion-frame', width: 620 }, '*']);
  const grip = frame.resizeEl;
  assert.equal(grip.attributes['aria-label'], 'AKARI バイブの横幅を変える');
  assert.equal(grip.attributes.title, 'AKARI バイブの横幅を変える');
  const right = frame.x + frame.size.width;
  grip.dispatch('mousedown', mouse(400));
  win.dispatch('mousemove', mouse(100));
  assert.equal(frame.size.width, 720);
  assert.equal(frame.x + frame.size.width, right);
  assert.deepEqual(firstIframe.messages.at(-1), [{ type: 'akari-companion-frame', width: 720 }, '*']);
  win.dispatch('mousemove', mouse(1000));
  assert.equal(frame.size.width, 360);
  assert.equal(frame.x + frame.size.width, right);
  assert.deepEqual(JSON.parse(values.get(storageKey)), { width: 360 });
  win.dispatch('mouseup');
  frame.unmount();
  mount();
  assert.equal(frame.size.width, 360);
  assert.equal(frame.panelEl.dataset.placement, 'anchored');
  assert.deepEqual(frame.iframeEl.messages.at(-1), [{ type: 'akari-companion-frame', width: 360 }, '*']);
  message({ type: 'akari-companion-panel', width: 620, height: 480, mode: 'tab' });
  assert.equal(frame.size.width, 360);
  frame.resetPlacement();
  assert.equal(frame.size.width, 620);
  assert.equal(values.has(storageKey), false);
  assert.deepEqual(frame.iframeEl.messages.at(-1), [{ type: 'akari-companion-frame', width: 620 }, '*']);
  frame.unmount();
});

test('pill は中身の幅と角丸を使い、つまみは pill と小さい枠で隠す', async () => {
  const { frame, win, mount, message } = fixture();
  mount();
  frame.resizeEl.dispatch('mousedown', mouse(400));
  win.dispatch('mousemove', mouse(1000));
  win.dispatch('mouseup');
  assert.equal(frame.size.width, 360);
  message({ type: 'akari-companion-panel', width: 44, height: 44, mode: 'pill' });
  assert.equal(frame.size.width, 44);
  assert.equal(frame.resizeEl.style.display, 'none');
  message({ type: 'akari-companion-panel', width: 620, height: 200, mode: 'tab' });
  assert.equal(frame.size.width, 360);
  assert.equal(frame.resizeEl.style.display, '');
  frame.resetPlacement();
  message({ type: 'akari-companion-panel', width: 100, height: 60, mode: 'tab' });
  assert.equal(frame.resizeEl.style.display, 'none');
  assert.equal(frame.cornerEl.style.display, 'none');
  frame.unmount();

  const style = await readFile(new URL('../src/browser/companion-panel-pulse-style.ts', import.meta.url), 'utf8');
  assert.match(style, /\.akari-companion-panel\[data-mode='pill'\] \{\s*border-radius: 22px;/);
});

test('つまみの操作面は押下中だけ iframe の上を覆う', () => {
  const { frame, win, mount } = fixture();
  mount();
  const grip = frame.resizeEl;
  grip.dispatch('mousedown', mouse(400));
  assert.equal(frame.resizeSurface.className, 'akari-companion-resize-surface');
  assert.match(frame.resizeSurface.attributes.style, /position:fixed; inset:0; pointer-events:auto; cursor:nesw-resize/);
  assert.equal(frame.resizeSurface.parent, frame.rootEl);
  win.dispatch('mousemove', mouse(350));
  assert.equal(frame.size.width, 670);
  win.dispatch('mousemove', mouse(300, 0));
  assert.equal(frame.resizeSurface, undefined);
  assert.equal(frame.size.width, 670);

  grip.dispatch('mousedown', mouse(400));
  win.dispatch('mouseup');
  assert.equal(frame.resizeSurface, undefined);
  grip.dispatch('mousedown', mouse(400));
  win.dispatch('blur');
  assert.equal(frame.resizeSurface, undefined);
  grip.dispatch('mousedown', mouse(400));
  const surface = frame.resizeSurface;
  frame.unmount();
  assert.equal(frame.resizeSurface, undefined);
  assert.equal(surface.parent, undefined);
});

test('中身からの高さは 720 と画面の高さに収める', () => {
  const { frame, win, mount, message } = fixture();
  mount();
  message({ type: 'akari-companion-panel', width: 620, height: 1000 });
  assert.equal(frame.size.height, 720);
  win.innerHeight = 500;
  message({ type: 'akari-companion-panel', width: 620, height: 1000 });
  assert.equal(frame.size.height, 500);
  frame.unmount();
});

test('閉じるボタンは背景の四角を持たない', async () => {
  const style = await readFile(new URL('../src/browser/companion-panel-pulse-style.ts', import.meta.url), 'utf8');
  const corner = style.match(/\.akari-companion-panel-corner \{([^}]+)\}/)?.[1];
  const hover = style.match(/\.akari-companion-panel-corner:hover \{([^}]+)\}/)?.[1];
  assert.match(corner, /background: transparent;/);
  assert.doesNotMatch(corner, /border-radius:|box-shadow:/);
  assert.doesNotMatch(hover, /background:|box-shadow:/);
  assert.match(hover, /color: var\(--theia-foreground/);
  assert.match(corner, /width: 32px;\s*height: 32px;/);
});
