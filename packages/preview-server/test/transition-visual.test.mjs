import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  createTransitionVisualApplicator,
  transitionDissolveTableValues,
  transitionEngineBlockSize,
} from '../public/transition-visual.js';

const { computeTransitionVisual, TRANSITION_BY_ID } = createRequire(import.meta.url)(
  '../../edit-store/lib/index.js',
);

function visual(type, progress) {
  const definition = TRANSITION_BY_ID[type];
  return computeTransitionVisual(
    definition?.previewKind || 'fallback',
    progress,
    definition?.labelJa || String(type),
  );
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.id = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
}

class FakeDocument {
  constructor() {
    this.roots = [];
    this.canvasLogs = [];
  }
  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    if (tagName === 'canvas') {
      const log = [];
      const context = {
        clearRect: (...args) => log.push(['clearRect', ...args]),
        drawImage: (...args) => log.push(['drawImage', ...args]),
      };
      Object.defineProperty(context, 'globalAlpha', { set: value => log.push(['globalAlpha', value]) });
      Object.defineProperty(context, 'imageSmoothingEnabled', { set: value => log.push(['smooth', value]) });
      Object.defineProperty(context, 'webkitImageSmoothingEnabled', { set: value => log.push(['webkitSmooth', value]) });
      element.getContext = () => context;
      element.log = log;
      this.canvasLogs.push(log);
    }
    return element;
  }
  createElementNS(_namespace, tagName) { return this.createElement(tagName); }
  getElementById(id) {
    const visit = element => {
      if (element.id === id) return element;
      for (const child of element.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    for (const root of this.roots) {
      const found = visit(root);
      if (found) return found;
    }
    return null;
  }
}

function fixture() {
  const documentRef = new FakeDocument();
  const stage = documentRef.createElement('div');
  const outgoing = documentRef.createElement('video');
  const incoming = documentRef.createElement('video');
  const plate = documentRef.createElement('div');
  const fallbackLabel = documentRef.createElement('div');
  stage.append(outgoing, incoming, plate, fallbackLabel);
  documentRef.roots.push(stage);
  outgoing.readyState = 2;
  outgoing.videoWidth = 1920;
  outgoing.videoHeight = 1080;
  incoming.readyState = 2;
  incoming.videoWidth = 1920;
  incoming.videoHeight = 1080;
  let rerenders = 0;
  const applicator = createTransitionVisualApplicator({
    stage,
    incomingElement: incoming,
    plate,
    fallbackLabel,
    rerender: () => { rerenders += 1; },
    documentRef,
  });
  const apply = (type, progress, overrides = {}) => applicator.apply({
    visual: visual(type, progress),
    type,
    outgoingElement: outgoing,
    outgoingBaseTransform: 'scale(0.9)',
    incomingBaseTransform: 'rotate(2deg)',
    incomingTransformOrigin: '50% 50%',
    outgoingBaseOpacity: 0.8,
    incomingBaseOpacity: 0.6,
    outgoingZ: 0,
    incomingZ: 1,
    width: 640,
    height: 360,
    ...overrides,
  });
  return { documentRef, stage, outgoing, incoming, plate, fallbackLabel, applicator, apply, rerenders: () => rerenders };
}

test('Web 適用器は共有レシピの opacity / transform / clip / mask / plate / zSwap を全て適用する', () => {
  for (const type of [
    'fade', 'fade-black', 'wipe-left', 'slide-left', 'cover-up', 'reveal-left', 'circle-open', 'radial',
  ]) {
    for (const progress of [0.2, 0.5, 0.8]) {
      const f = fixture();
      const expected = visual(type, progress);
      f.apply(type, progress);
      assert.equal(f.outgoing.style.opacity, String(0.8 * expected.outgoingOpacity), `${type} out opacity`);
      assert.equal(f.incoming.style.opacity, String(0.6 * expected.incomingOpacity), `${type} in opacity`);
      assert.equal(f.outgoing.style.transform, ['scale(0.9)', expected.outgoingTransform].filter(Boolean).join(' '), `${type} out transform`);
      assert.equal(f.incoming.style.transform, ['rotate(2deg)', expected.incomingTransform].filter(Boolean).join(' '), `${type} in transform`);
      assert.equal(f.incoming.style.clipPath, expected.incomingClipPath, `${type} clip`);
      assert.equal(f.outgoing.style.maskImage, expected.outgoingMask === 'none' ? '' : expected.outgoingMask, `${type} out mask`);
      assert.equal(f.incoming.style.maskImage, expected.incomingMask === 'none' ? '' : expected.incomingMask, `${type} in mask`);
      assert.equal(f.outgoing.style.zIndex, expected.zSwap ? '2' : '0', `${type} zSwap`);
      assert.equal(f.plate.style.opacity, String(expected.plateOpacity), `${type} plate`);
      assert.equal(f.outgoing.dataset.akariTransitionProgress, progress.toFixed(3), `${type} progress`);
    }
  }
});

test('fade-black は共有カーネルの非対称 plate カーブをそのまま Web DOM へ適用する', () => {
  for (const [progress, expected] of [[0.125, 0.694444], [0.25, 1], [0.75, 0.357143]]) {
    const f = fixture();
    f.apply('fade-black', progress);
    assert.ok(Math.abs(Number(f.plate.style.opacity) - expected) < 0.00001, String(progress));
    assert.equal(f.plate.style.background, '#000');
  }
});

test('未知種別は共有カーネルと同文言の日本語フォールバックを表示する', () => {
  const f = fixture();
  f.apply('future-transition-x', 0.25);
  assert.equal(f.fallbackLabel.textContent, 'future-transition-x — プレビュー近似なし');
  assert.equal(f.fallbackLabel.style.display, 'block');
  assert.equal(f.fallbackLabel.dataset.akariTransitionFallback, 'future-transition-x');
});

test('方向性ブラーとノイズディゾルブは条件起動し、切替と reset で SVG を片付ける', () => {
  const f = fixture();
  f.apply('blur', 0.5);
  const blur = f.documentRef.getElementById('akari-transition-hblur-node');
  assert.equal(blur.getAttribute('stdDeviation'), '48 0');
  assert.equal(blur.getAttribute('edgeMode'), 'duplicate');
  assert.equal(f.outgoing.style.filter, 'url(#akari-transition-hblur)');
  assert.equal(f.incoming.style.filter, 'url(#akari-transition-hblur)');

  f.apply('dissolve', 0.5);
  assert.equal(f.documentRef.getElementById('transition-engine-filters') !== null, true);
  assert.equal(f.outgoing.style.filter, '');
  assert.equal(f.incoming.style.filter, 'url(#akari-transition-dissolve)');
  const table = f.documentRef.getElementById('akari-transition-dissolve-table');
  assert.equal(table.getAttribute('type'), 'discrete');
  assert.equal(table.getAttribute('tableValues').split(' ').filter(value => value === '1').length, 62);
  const turbulence = f.documentRef.getElementById('transition-engine-filters').children[0].children[1].children[0];
  assert.equal(turbulence.getAttribute('seed'), '7');

  f.applicator.reset();
  assert.equal(f.documentRef.getElementById('transition-engine-filters'), null);
  assert.equal(f.incoming.style.display, 'none');
});

test('adjust 基底と合成済み transition filter を保ち、reset は基底へ戻す', () => {
  const f = fixture();
  f.outgoing.dataset.akariAdjustFilter = 'brightness(2.00)';
  f.incoming.dataset.akariAdjustFilter = 'contrast(1.25)';
  f.apply('blur', 0.5, {
    outgoingFilter: 'brightness(2.00) url(#akari-transition-hblur)',
    incomingFilter: 'contrast(1.25) url(#akari-transition-hblur)',
  });
  assert.equal(f.outgoing.style.filter, 'brightness(2.00) url(#akari-transition-hblur)');
  assert.equal(f.incoming.style.filter, 'contrast(1.25) url(#akari-transition-hblur)');
  f.applicator.reset();
  assert.equal(f.outgoing.style.filter, 'brightness(2.00)');
  assert.equal(f.incoming.style.filter, 'contrast(1.25)');
});

test('pixelize は宣言 block 辺で nearest-neighbor canvas を全描画し、同一適用で増殖しない', () => {
  const f = fixture();
  f.apply('pixelize', 0.5);
  const canvas = f.documentRef.getElementById('transition-pixelize-canvas');
  assert.ok(canvas);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.equal(transitionEngineBlockSize(visual('pixelize', 0.5).pixelBlockRatio, 640), 29);
  assert.equal(canvas.style.display, 'block');
  const mainDraw = canvas.log.find(entry => entry[0] === 'drawImage');
  assert.deepEqual(mainDraw.slice(2), [0, 0, 23, 13, -14, -9, 667, 377]);
  f.apply('pixelize', 0.5);
  assert.equal(f.stage.children.filter(child => child.id === 'transition-pixelize-canvas').length, 1);
  f.applicator.reset();
  assert.equal(f.documentRef.getElementById('transition-pixelize-canvas'), null);
});

test('通常レシピと inert 状態は canvas / SVG filter を増設しない', () => {
  const f = fixture();
  f.apply('wipe-left', 0.5);
  assert.equal(f.documentRef.getElementById('transition-engine-filters'), null);
  assert.equal(f.documentRef.getElementById('transition-pixelize-canvas'), null);
  f.applicator.reset();
  assert.equal(f.documentRef.getElementById('transition-engine-filters'), null);
  assert.equal(f.documentRef.getElementById('transition-pixelize-canvas'), null);
});

test('dissolve 較正表は代表点・単調性・決定論を保つ', () => {
  const visible = progress => transitionDissolveTableValues(progress, 256)
    .split(' ').filter(value => value === '1').length;
  assert.deepEqual([visible(0), visible(0.25), visible(0.5), visible(0.75), visible(1)], [0, 44, 62, 84, 256]);
  let previous = -1;
  for (let step = 0; step <= 128; step += 1) {
    const current = visible(step / 128);
    assert.ok(current >= previous);
    assert.equal(current, visible(step / 128));
    previous = current;
  }
});
