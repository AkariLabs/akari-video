import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { captionCornerTransform } from '../lib/common/caption-plate-handles.js';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const declaration = name => {
  const start = source.indexOf(`const ${name} =`);
  const end = source.indexOf('\n            };', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 15);
};

test('caption arriving after the selection message creates all eight handles', () => {
  const box = { children: [], classList: { remove() {} },
    querySelector() { return this.children[0] ?? null; }, appendChild(child) { this.children.push(child); } };
  const context = vm.createContext({
    captionRows: new Map(), captionSelectBox: box, captions: [],
    selectedCaptionIds: new Set(['c-0001']), selectedCaptionId: 'c-0001', captionAltAll: false,
    captionGestureCount: 0, selectionDragActive: false, outputTime: 0,
    window: { AkariEditKernel: { findActiveCaptions: captions => captions } },
    captionPalette: { hidden: false }, captionRowBox: { classList: { remove() {} } },
    updateCaptionMultiSelectBoxes() {}, updateCaptionSelectTools() {},
    captionVisualRect: () => ({ left: 0, right: 100, top: 0, bottom: 40 }),
    updateCaptionSelectBoxForRect() {},
    document: { createElement() { return { children: [], style: {}, attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key]; },
      appendChild(child) { this.children.push(child); }, remove() {} }; } },
    syncCaptionHandleBox() {}
  });
  vm.runInContext(`${declaration('selectedCaption')}\n${declaration('applyCaptionRowSelectionAttrs')}\n`
    + `${declaration('applyCaptionSelectionAttrs')}\n${declaration('updateCaptionSelectBox')}`, context);
  vm.runInContext('updateCaptionSelectBox()', context);
  assert.equal(box.children.length, 0);
  vm.runInContext("captions = [{ id: 'c-0001', textStyle: { size_px: 80, text_anchor: 'tc', position: { y: .4625 } } }]; updateCaptionSelectBox()", context);
  assert.deepEqual(box.children[0].children.map(handle => handle.getAttribute?.('data-h') ?? handle.kind),
    ['nw', 'ne', 'sw', 'se', 'e', 'w', 'rot', 'move']);
  const update = source.slice(source.indexOf("if (message && message.type === 'akari-preview-captions-update')"),
    source.indexOf("if (message && message.type === 'akari-preview-audio-update')"));
  assert.match(update, /renderCaption\(\);\s*resumeCaptionMotionAfterRender\(\);[\s\S]*?updateCaptionSelectBox\(\);/u);
  assert.doesNotMatch(declaration('applyCaptionSelectionAttrs'), /updateCaptionSelectBox\(/u);
});

test('all corners keep the opposite corner fixed for an 80px tc cue without x', () => {
  assert.match(source, /captionPlate\.style\.setProperty\('--caption-width', next\.width \+ 'px'\)/u);
  assert.match(source, /captionPlate\.style\.setProperty\('--caption-line-max-width', '100%'\)/u);
  const size_px = 80;
  const frame = { width: 1920, height: 1080 };
  const layout = { left: 810, right: 1110, top: .4625 * frame.height,
    bottom: .4625 * frame.height + size_px * 1.42 };
  for (const kind of ['nw', 'ne', 'sw', 'se']) {
    const opposite = { x: kind.endsWith('w') ? layout.right : layout.left,
      y: kind.startsWith('n') ? layout.bottom : layout.top };
    const dragged = { x: kind.endsWith('w') ? layout.left : layout.right,
      y: kind.startsWith('n') ? layout.top : layout.bottom };
    const pointer = { x: opposite.x + (dragged.x - opposite.x) * 1.5,
      y: opposite.y + (dragged.y - opposite.y) * 1.5 };
    const next = captionCornerTransform(kind, layout, 1, 0, pointer);
    assert.equal(next.width, layout.right - layout.left, `${kind} live plate width`);
    const center = { x: next.left + next.width / 2,
      y: next.top + (layout.bottom - layout.top) / 2 };
    const fixed = { x: center.x + (kind.endsWith('w') ? 1 : -1) * (layout.right - layout.left) / 2 * next.scale,
      y: center.y + (kind.startsWith('n') ? 1 : -1) * (layout.bottom - layout.top) / 2 * next.scale };
    assert.ok(Math.hypot(fixed.x - opposite.x, fixed.y - opposite.y) < 0.01, kind);
    if (kind === 'se') {
      const oldCenteredPlateWidth = frame.width * .92;
      const oldFixedX = next.left + oldCenteredPlateWidth / 2 - next.scale * oldCenteredPlateWidth / 2;
      assert.ok(Math.abs(oldFixedX - opposite.x) > 100);
    }
  }
});
