import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { matchesPreviewZOrderSelection, planAdjacentVisualTrackMove, planZOrderMove }
  from '../lib/browser/inspector/keyboard-shortcuts.js';
import { moveTreeV2Item } from '../lib/common/edit-v2-mutations.js';

const leaf = id => ({ id, at: 10, duration: 20, source: { kind: 'html', path: `${id}.html` } });
const doc = () => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [
    { id: 'V1', lane: 'visual', items: [leaf('a')] },
    { id: 'A1', lane: 'audio', items: [] },
    { id: 'V2', lane: 'visual', items: [leaf('b')] },
    { id: 'V3', lane: 'visual', items: [{ id: 'g', at: 10, duration: 20,
      source: { kind: 'group' }, items: [leaf('c'), leaf('d'), leaf('e')] }] }
  ] });

test('top-level four operations choose the same visual ranks as adjacent shortcuts', () => {
  const value = doc();
  assert.deepEqual(planZOrderMove(value, 'a', 'forward'), { target: { track: 'V2' }, atFrames: 10 });
  assert.deepEqual(planZOrderMove(value, 'a', 'front'), { target: { track: 'V3' }, atFrames: 10 });
  assert.deepEqual(planZOrderMove(value, 'b', 'backward'), { target: { track: 'V1' }, atFrames: 10 });
  assert.deepEqual(planZOrderMove(value, 'g', 'back'), { target: { track: 'V1' }, atFrames: 10 });
  for (const [id, direction, op] of [['a', 1, 'forward'], ['b', -1, 'backward']]) {
    const old = planAdjacentVisualTrackMove(value.tracks, id, direction);
    assert.equal(planZOrderMove(value, id, op).target.track, old.targetTrackId);
    assert.equal(planZOrderMove(value, id, op).atFrames, old.atFrames);
  }
  assert.deepEqual(planZOrderMove(value, 'a', 'backward'), { blocked: 'back' });
  assert.deepEqual(planZOrderMove(value, 'a', 'back'), { blocked: 'back' });
  assert.deepEqual(planZOrderMove(value, 'g', 'forward'), { blocked: 'front' });
  assert.deepEqual(planZOrderMove(value, 'g', 'front'), { blocked: 'front' });
  assert.deepEqual(planZOrderMove(value, 'missing', 'front'), {});
  assert.deepEqual(planZOrderMove(value, 'bag#part', 'front'), {});
});

test('group child four operations use sibling indices and moveItem preserves the parent', () => {
  const value = doc();
  const cases = [
    ['c', 'forward', 1, ['d', 'c', 'e']],
    ['c', 'front', 2, ['d', 'e', 'c']],
    ['e', 'backward', 1, ['c', 'e', 'd']],
    ['e', 'back', 0, ['e', 'c', 'd']]
  ];
  for (const [id, op, index, order] of cases) {
    const plan = planZOrderMove(value, id, op);
    assert.deepEqual(plan, { target: { parent: 'g', index } });
    const moved = moveTreeV2Item(value, id, plan.target).document;
    assert.deepEqual(moved.tracks.find(track => track.id === 'V3').items[0].items.map(item => item.id), order);
    assert.deepEqual(value.tracks[3].items[0].items.map(item => item.id), ['c', 'd', 'e']);
  }
  assert.deepEqual(planZOrderMove(value, 'c', 'backward'), { blocked: 'back' });
  assert.deepEqual(planZOrderMove(value, 'c', 'back'), { blocked: 'back' });
  assert.deepEqual(planZOrderMove(value, 'e', 'forward'), { blocked: 'front' });
  assert.deepEqual(planZOrderMove(value, 'e', 'front'), { blocked: 'front' });
});

test('children of non-group bags never acquire a sibling z-order plan', () => {
  const value = doc();
  for (const kind of ['html', 'captions']) {
    value.tracks.push({ id: `bag-track-${kind}`, lane: 'visual', items: [{
      id: `${kind}-bag`, at: 10, duration: 20, source: { kind },
      items: [leaf(`${kind}-child-a`), leaf(`${kind}-child-b`)]
    }] });
  }
  for (const kind of ['html', 'captions']) {
    for (const op of ['front', 'forward', 'backward', 'back']) {
      assert.deepEqual(planZOrderMove(value, `${kind}-child-a`, op), {}, `${kind} ${op}`);
      assert.deepEqual(planZOrderMove(value, `${kind}-child-b`, op), {}, `${kind} ${op}`);
    }
  }
  assert.deepEqual(planZOrderMove(value, 'html-bag', 'forward'),
    { target: { track: 'bag-track-captions' }, atFrames: 10 });
});

test('nested group children use the innermost group for all four operations', () => {
  const value = doc();
  value.tracks.push({ id: 'nested-track', lane: 'visual', items: [{
    id: 'outer', at: 10, duration: 20, source: { kind: 'group' },
    items: [leaf('outer-a'), { id: 'inner', at: 10, duration: 20,
      source: { kind: 'group' }, items: [leaf('inner-a'), leaf('inner-b'), leaf('inner-c')] }, leaf('outer-b')]
  }] });
  for (const [id, op, index] of [
    ['inner-a', 'forward', 1], ['inner-a', 'front', 2],
    ['inner-c', 'backward', 1], ['inner-c', 'back', 0]
  ]) {
    assert.deepEqual(planZOrderMove(value, id, op), { target: { parent: 'inner', index } });
  }
  assert.deepEqual(planZOrderMove(value, 'inner', 'forward'), { target: { parent: 'outer', index: 2 } });
});

test('shortcut and preview receiver share the plan, and mismatched selection exits before mutation', () => {
  assert.equal(matchesPreviewZOrderSelection('a', ['a'], false), true);
  assert.equal(matchesPreviewZOrderSelection('a', ['b'], false), false);
  assert.equal(matchesPreviewZOrderSelection('a', ['a', 'b'], false), false);
  assert.equal(matchesPreviewZOrderSelection('a', ['a'], true), false);
  assert.equal(matchesPreviewZOrderSelection('bag#part', ['bag#part'], false), false);
  const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const receiver = widget.slice(widget.indexOf('    runPreviewZOrderCommand('), widget.indexOf('    protected moveSelectedZOrder('));
  assert.match(receiver, /if \(!matchesPreviewZOrderSelection\(id, selectedIds, this\.multiSelection\.length > 0\)\) return;/u);
  assert.match(receiver, /this\.moveSelectedZOrder\(id, op, '重なり順を変更'\)/u);
  assert.match(widget, /this\.moveSelectedZOrder\(id, event\.key === '\]' \? 'forward' : 'backward'/u);
  assert.match(widget, /const plan = planZOrderMove\(this\.editDocument, id, op\)/u);
  assert.match(widget, /commitEditMutation\(label, doc =>/u);
  assert.match(widget, /いちばん前面です/u);
  assert.match(widget, /いちばん背面です/u);
});
