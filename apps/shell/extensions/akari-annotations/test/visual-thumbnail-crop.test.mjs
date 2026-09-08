import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { visualThumbnailCrop } from '../lib/common/visual-thumbnail-crop.js';

const page = { width: 1920, height: 1080 };
const lower = { x: 50, y: 850, width: 874, height: 115 };
const center = { x: 610, y: 491, width: 701, height: 97 };
const focus = crop => crop.objectPosition.split(' ').map(parseFloat);
const padded = rect => {
  const x = Math.max(0, rect.x - 0.04 * rect.width), y = Math.max(0, rect.y - 0.04 * rect.height);
  return { x, y, width: Math.min(page.width, rect.x + 1.04 * rect.width) - x,
    height: Math.min(page.height, rect.y + 1.04 * rect.height) - y };
};

test('full-page content and exactly 60 percent coverage retain contain', () => {
  assert.equal(visualThumbnailCrop({ x: 100, y: 80, width: 1661, height: 898 }, page), undefined);
  assert.equal(visualThumbnailCrop({ x: 0, y: 0, width: 1152, height: 1080 }, page), undefined);
});

test('lower thirds use CSS focus percentages and vertical background magnification', () => {
  const crop = visualThumbnailCrop(lower, page);
  const [x, y] = focus(crop);
  assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
  assert.ok(crop.scale > 1);
  const r = padded(lower);
  assert.equal(x, Math.round(10000 * r.x / (page.width - r.width)) / 100);
  assert.equal(crop.backgroundPosition, crop.objectPosition);
  assert.ok(Math.abs(parseFloat(crop.backgroundSize.slice(5)) - 100 * page.height / r.height) < 1e-9);
});

test('central one-line captions focus near the center', () => {
  const [x, y] = focus(visualThumbnailCrop(center, page));
  assert.ok(Math.abs(x - 50) < 0.1 && Math.abs(y - 50) < 0.1);
});

test('padding clamps at either page edge', () => {
  assert.equal(visualThumbnailCrop({ x: 0, y: 0, width: 300, height: 100 }, page).objectPosition, '0% 0%');
  assert.equal(visualThumbnailCrop({ x: 1620, y: 980, width: 300, height: 100 }, page).objectPosition, '100% 100%');
});

test('missing or invalid bounds and page dimensions do not crop', () => {
  assert.equal(visualThumbnailCrop(undefined, page), undefined);
  for (const rect of [{ ...lower, width: 0 }, { ...lower, height: -1 }, { ...lower, x: NaN },
    { ...lower, y: Infinity }, { ...lower, width: Infinity }, { ...lower, height: NaN }, { ...lower, x: 3000 }]) {
    assert.equal(visualThumbnailCrop(rect, page), undefined);
  }
  for (const bad of [{ width: 0, height: 1080 }, { width: 1920, height: Infinity }, { width: NaN, height: 1080 }]) {
    assert.equal(visualThumbnailCrop(lower, bad), undefined);
  }
});

test('custom coverage and padding options are honored', () => {
  assert.equal(visualThumbnailCrop(lower, page, { minCoverage: 0.01 }), undefined);
  const crop = visualThumbnailCrop({ x: 0, y: 0, width: 960, height: 108 }, page, { pad: 0 });
  assert.equal(crop.scale, 10);
  assert.equal(crop.backgroundSize, 'auto 1000%');
});

test('transformed padded rectangles cover narrow, normal and long strips', () => {
  for (const rect of [lower, center, { x: 0, y: 0, width: 300, height: 100 },
    { x: 1620, y: 980, width: 300, height: 100 }]) {
    const crop = visualThumbnailCrop(rect, page), r = padded(rect);
    const [px, py] = focus(crop).map(value => value / 100);
    for (const [width, height] of [[240, 72], [56, 72], [600, 40]]) {
      const k = Math.max(width / page.width, height / page.height);
      const offsetX = (width - page.width * k) * px, offsetY = (height - page.height * k) * py;
      const x = px * width + crop.scale * (offsetX + k * r.x - px * width);
      const y = py * height + crop.scale * (offsetY + k * r.y - py * height);
      assert.ok(x <= 1e-9 && x + crop.scale * k * r.width >= width - 1e-9, `horizontal coverage: ${JSON.stringify({ rect, width, height, x })}`);
      assert.ok(y <= 1e-9 && y + crop.scale * k * r.height >= height - 1e-9, `vertical coverage: ${JSON.stringify({ rect, width, height, y })}`);
    }
  }
});

test('widget crops page-coordinate bounds on images and tiles and resets reused styles', () => {
  const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
  const method = klass.members.find(node => node.name?.getText(source) === 'renderVisualThumbnail').getText(source);
  const code = ts.transpileModule(`class Widget { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  class Element {
    isConnected = true; dataset = {}; style = {}; classList = { add() {} }; children = [];
    bounds = { left: 0, right: 240, top: 0, bottom: 72, width: 240, height: 72 };
    getBoundingClientRect() { return this.bounds; }
    querySelector(selector) { return selector.includes('image') ? this.children[0] : undefined; }
    prepend(child) { this.children.unshift(child); }
    addEventListener() {}
    getAttribute(name) { return this[name]; }
  }
  const Widget = new Function('window', 'document', 'visualThumbnailKey', 'visualThumbnailSnapshot', 'require', `${code}; return Widget;`)(
    { electronAkariPreview: { captureVisualThumbnail() { assert.fail('cached styles must not recapture'); } } },
    { createElement: () => new Element() }, () => 'key', () => 'snapshot',
    id => { assert.equal(id, '../common/visual-thumbnail-crop'); return { visualThumbnailCrop }; });
  let value = { image: 'pixels', contentRect: { x: 12.5, y: 212.5, width: 218.5, height: 28.75 } };
  const widget = new Widget();
  Object.assign(widget, { location: { editUri: { toString: () => 'file:///edit.json' } },
    visualDependencyRevisions: new Map(), visualKeys: new WeakMap(), visualInputEpoch: 0,
    stripScroll: new Element(), editDocument: { output: page }, visualThumbnails: { request: () => value } });
  const element = new Element();
  const render = () => widget.renderVisualThumbnail(element, 'title', 'Title', {});
  render();
  const image = element.children[0], crop = visualThumbnailCrop(lower, page);
  assert.equal(image.src, 'pixels');
  assert.equal(image.style.objectFit, 'cover');
  assert.equal(image.style.transform, `scale(${crop.scale})`);
  assert.equal(image.style.objectPosition, crop.objectPosition);
  assert.equal(image.style.transformOrigin, crop.objectPosition);
  assert.equal(image.style.visibility, 'hidden');
  assert.equal(element.style.backgroundSize, `${crop.backgroundSize}, 12px 12px`);
  assert.equal(element.style.backgroundPosition, `${crop.objectPosition}, 0 0`);
  element.bounds.width = 56;
  render();
  assert.equal(image.style.visibility, 'visible');
  assert.equal(image.style.transform, `scale(${crop.scale})`);

  const assertContain = () => {
    assert.equal(element.children[0], image);
    assert.equal(image.style.objectFit, 'contain');
    assert.equal(image.style.transform, '');
    assert.equal(image.style.transformOrigin, '');
    assert.equal(image.style.objectPosition, '');
    assert.equal(element.style.backgroundSize, 'auto 100%, 12px 12px');
    assert.equal(element.style.backgroundPosition, 'left center, 0 0');
  };
  const cropped = value;
  for (const full of [{ x: 25, y: 20, width: 415.25, height: 224.5 }, undefined]) {
    value = cropped; render();
    value = { image: 'full', contentRect: full }; render(); assertContain();
  }
  value = cropped; render();
  widget.editDocument = undefined; render(); assertContain();
});
