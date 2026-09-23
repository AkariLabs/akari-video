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

test('tree HTML live scale preserves axis ratio and axis previews accept restoration', () => {
  const current = { cuts: [], layers: [], tree: [{ id: 'html-leaf',
    transform: { scale: 1, scaleX: 1.5, scaleY: .75 } }] };
  const target = { kind: 'item', id: 'html-leaf' };
  const halfway = summaryWithLivePreview(current, { target, field: 'scale', value: .5 });
  const a = halfway.tree[0].transform;
  assert.ok(Math.abs(Math.sqrt(a.scaleX * a.scaleY) - .5) < 1e-9);
  assert.ok(Math.abs(a.scaleX / a.scaleY - 2) < 1e-9);
  const restored = summaryWithLivePreview(current, { target, field: 'scaleX', value: 1.5 });
  assert.equal(restored.tree[0].transform.scaleX, 1.5);
  assert.deepEqual(current.tree[0].transform, { scale: 1, scaleX: 1.5, scaleY: .75 });
});

test('grouped HTML live width and X stay in world coordinates through a bag and restore', () => {
  const parent = { x: 100, y: 0, scale: 2, rotate: 90 };
  const original = { x: 90, y: 20, scale: 2, scaleX: 3, scaleY: 1.5, rotate: 120 };
  const tree = [
    { id: 'group', kind: 'group', parentId: null, transform: parent },
    { id: 'bag', kind: 'bag', parentId: 'group', transform: { x: 999, scale: 9 } },
    { id: 'html-leaf', kind: 'leaf', parentId: 'bag', transform: original }
  ];
  const current = { cuts: [], layers: [], tree };
  const target = { kind: 'item', id: 'html-leaf' };
  const world = (field, value) => summaryWithLivePreview(current, { target, field, value }).tree[2].transform;
  assert.deepEqual(world('scaleX', 2), { x: 90, y: 20, scale: 2, scaleX: 4, scaleY: 1.5, rotate: 120 });
  assert.deepEqual(world('x', 25), { x: 90, y: 50, scale: 2, scaleX: 3, scaleY: 1.5, rotate: 120 });
  assert.deepEqual(world('scaleX', 1.5), original);
  assert.deepEqual(world('x', 10), original);

  const css = new Map();
  const overlay = {
    getAttribute: name => name === 'data-overlay-id' ? 'html-leaf' : null,
    style: { getPropertyValue: name => css.get(name) || '',
      setProperty: (name, value) => css.set(name, value), removeProperty: name => css.delete(name) }
  };
  const previousStage = globalThis.stage, previousSummary = globalThis.summary;
  globalThis.stage = { querySelectorAll: () => [overlay] };
  globalThis.summary = current;
  try {
    receive(target, 'scaleX', 2);
    assert.deepEqual(Object.fromEntries(css), {
      '--x': '90px', '--y': '20px', '--scale': '2',
      '--scale-x': '4', '--scale-y': '1.5', '--rotate': '120deg'
    });
    receive(target, 'x', 25);
    assert.equal(css.get('--x'), '90px');
    assert.equal(css.get('--y'), '50px');
    receive(target, 'scaleX', 1.5);
    receive(target, 'x', 10);
    assert.deepEqual(Object.fromEntries(css), {
      '--x': '90px', '--y': '20px', '--scale': '2',
      '--scale-x': '3', '--scale-y': '1.5', '--rotate': '120deg'
    });
  } finally {
    if (previousStage === undefined) delete globalThis.stage;
    else globalThis.stage = previousStage;
    if (previousSummary === undefined) delete globalThis.summary;
    else globalThis.summary = previousSummary;
  }
});

test('HTML live width uses the current inline world pose when tree and frame-engine summary are stale', () => {
  const original = { x: 280, y: -105, scale: 1, rotate: 0 };
  const committed = { x: 674.26, y: -319.55, scale: 1, scaleX: 2.297, scaleY: 2.4848, rotate: 0 };
  const target = { kind: 'item', id: 'html-leaf' };
  const tree = [{ id: 'html-leaf', kind: 'leaf', parentId: null, transform: original }];
  const current = { cuts: [], layers: [], tree };
  const css = new Map(Object.entries({ '--x': '674.26px', '--y': '-319.55px', '--scale': '1',
    '--scale-x': '2.297', '--scale-y': '2.4848', '--rotate': '0deg' }));
  const overlay = { getAttribute: name => name === 'data-overlay-id' ? 'html-leaf' : null,
    style: { getPropertyValue: name => css.get(name) || '',
      setProperty: (name, value) => css.set(name, value), removeProperty: name => css.delete(name) } };
  const previousStage = globalThis.stage, previousSummary = globalThis.summary, previousWindow = globalThis.window;
  globalThis.stage = { querySelectorAll: () => [overlay] };
  globalThis.summary = current;
  globalThis.window = { akari: { state: { summary: { tree: [{ ...tree[0], transform: committed }] } } } };
  try {
    const preview = summaryWithLivePreview(current, { target, field: 'scaleX', value: 2.497 });
    assert.deepEqual(preview.tree[0].transform, { ...committed, scaleX: 2.497 });
    receive(target, 'scaleX', 2.497);
    assert.equal(css.get('--x'), '674.26px');
    assert.equal(css.get('--y'), '-319.55px');
    assert.equal(css.get('--scale-y'), '2.4848');
    assert.equal(css.get('--scale-x'), '2.497');
    assert.deepEqual(tree[0].transform, original);
  } finally {
    if (previousStage === undefined) delete globalThis.stage; else globalThis.stage = previousStage;
    if (previousSummary === undefined) delete globalThis.summary; else globalThis.summary = previousSummary;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
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
