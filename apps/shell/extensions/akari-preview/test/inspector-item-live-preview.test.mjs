import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return source.slice(from, to);
}
const summaryWithLivePreview = new Function(`
  ${between('const summaryWithLivePreview = ', 'const applyEngineSummary = ')}
  return summaryWithLivePreview;
`)();
const receiveLivePreview = new Function(
  'message', 'window', 'video', 'layersStage', 'CSS', 'updateLayerSelectBox',
  between("if (message && message.type === 'akari-preview-live-transform' && message.target", '\n            });')
);

function fixture() {
  return {
    cuts: [{ id: 'other-cut' }, { id: 'base-item', transform: { y: 7 } }],
    layers: [{ id: 'upper-item', transform: { y: 9 } }]
  };
}

for (const [id, collection, index] of [['base-item', 'cuts', 1], ['upper-item', 'layers', 0]]) {
  test(`frame engine item live preview resolves ${collection} by entry.id and preserves the source summary`, () => {
    for (const [field, value, read] of [
      ['x', 300, entry => entry.transform.x],
      ['rotate', 45, entry => entry.transform.rotate],
      ['scale', 1.5, entry => entry.transform.scale],
      ['crop.w', 0.5, entry => entry.crop.w],
      ['perspective.tl.x', 0.2, entry => entry.perspective.corners[0][0]],
      ['opacity', 0.6, entry => entry.opacity]
    ]) {
      const current = fixture();
      const original = structuredClone(current);
      const next = summaryWithLivePreview(current, { target: { kind: 'item', id, index: 0 }, field, value });
      assert.notEqual(next, current);
      assert.equal(read(next[collection][index]), value);
      assert.deepEqual(current, original);
      assert.equal(next[collection][index].transform.y, original[collection][index].transform.y);
      const other = collection === 'cuts' ? 'layers' : 'cuts';
      assert.equal(next[other], current[other]);
    }
  });
}

test('frame engine keeps legacy cut index and layer ID addressing and ignores missing items', () => {
  const current = fixture();
  assert.equal(summaryWithLivePreview(current, {
    target: { kind: 'cut', index: 0 }, field: 'x', value: 3
  }).cuts[0].transform.x, 3);
  assert.equal(summaryWithLivePreview(current, {
    target: { kind: 'layer', id: 'upper-item' }, field: 'x', value: 30
  }).layers[0].transform.x, 30);
  for (const target of [{ kind: 'item', id: 'absent' }, { kind: 'layer', id: 'base-item' }]) {
    assert.equal(summaryWithLivePreview(current, { target, field: 'x', value: 300 }), current);
  }
  assert.equal(summaryWithLivePreview({}, { target: { kind: 'item', id: 'absent' }, field: 'x', value: 3 }).cuts, undefined);
});

function receive(target, field, value, engineActive = false) {
  const video = { dataset: { akariCutId: 'base-item' }, style: {} };
  const layer = { dataset: { akariLayerId: 'upper-item' }, style: {} };
  const forwarded = [];
  let layouts = 0;
  let selections = 0;
  const message = { type: 'akari-preview-live-transform', target, field, value };
  receiveLivePreview(message, {
    akari: {
      updateLayerLayout: () => layouts++,
      ...(engineActive ? { frameEngineClock: { applyLivePreview: message => forwarded.push(message) } } : {})
    }
  }, video, {
    querySelector: selector => selector === 'video[data-akari-layer-id="upper-item"], img[data-akari-layer-id="upper-item"]' ? layer : null
  }, { escape: id => id }, () => selections++);
  return { video, layer, forwarded, layouts, selections, message };
}

for (const [id, element] of [['base-item', 'video'], ['upper-item', 'layer']]) {
  test(`legacy item live preview writes ${id} DOM values and requests layout`, () => {
    for (const [field, value, key] of [
      ['x', 300, 'akariTransformX'], ['y', 30, 'akariTransformY'],
      ['rotate', 45, 'akariTransformRotate'], ['scale', 1.5, 'akariTransformScale'],
      ['crop.x', 0.1, 'akariCropX'], ['crop.y', 0.2, 'akariCropY'],
      ['crop.w', 0.7, 'akariCropW'], ['crop.h', 0.6, 'akariCropH']
    ]) {
      const result = receive({ kind: 'item', id }, field, value);
      assert.equal(result[element].dataset[key], String(value));
      assert.equal(result[element === 'video' ? 'layer' : 'video'].dataset[key], undefined);
      if (element === 'video') assert.equal(result.video.dataset.akariCutTransformActive, 'true');
      assert.equal(result.layouts, 1);
      assert.equal(result.selections, 1);
    }
    const result = receive({ kind: 'item', id }, 'opacity', 0.5);
    assert.equal(result[element].style.opacity, '0.5');
    assert.equal(result.video.dataset.akariCutTransformActive, undefined);
  });
}

test('legacy receiver leaves unrelated cuts alone and forwards item messages to the frame engine', () => {
  for (const target of [{ kind: 'item', id: 'absent' }, { kind: 'layer', id: 'base-item' }]) {
    const result = receive(target, 'x', 300);
    assert.equal(result.video.dataset.akariTransformX, undefined);
    assert.equal(result.layer.dataset.akariTransformX, undefined);
  }
  for (const id of ['base-item', 'upper-item']) {
    const result = receive({ kind: 'item', id }, 'rotate', 45, true);
    assert.deepEqual(result.forwarded, [result.message]);
  }
});
