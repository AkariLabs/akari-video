import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { activateV2ItemTransformKeyframe, removeV2Keyframe,
  writeV2ItemTransformAt } from '../lib/common/edit-v2-mutations.js';
import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';
import { evaluatedItemTransform } from '../../../../../packages/edit-store/lib/transform-keyframe-edit.js';
import { resolvePreviewItemWrite } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';

const document = kind => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'subject', at: 0, duration: 180,
    transform: { x: 32, y: -18, scale: 1.1, rotate: 21 },
    source: kind === 'media' ? { kind: 'media', src: 'still', in: 0, out: 6 }
      : { kind: 'html', path: 'overlays/card.html' } }] }] });
const item = doc => doc.tracks[0].items[0];

test('toggle seats the visible transform for HTML and cut items', () => {
  for (const kind of ['html', 'media']) {
    const original = document(kind);
    let edit = activateV2ItemTransformKeyframe(original, { itemId: 'subject', t: 30, field: 'x' });
    assert.equal(item(edit).keyframes.find(point => point.t === 30).transform.x, 32);
    assert.deepEqual(evaluatedItemTransform(item(edit), 30), evaluatedItemTransform(item(original), 30));
    edit = activateV2ItemTransformKeyframe(edit, { itemId: 'subject', t: 30, field: 'rotate' });
    assert.equal(evaluatedItemTransform(item(edit), 30).rotate, 21);
    assert.deepEqual(item(original).transform, { x: 32, y: -18, scale: 1.1, rotate: 21 });
  }
});

test('numeric writes update one playhead point across on/interior/outside, then one undo restores it', async () => {
  let edit = document('html');
  edit = activateV2ItemTransformKeyframe(edit, { itemId: 'subject', t: 30, field: 'x' });
  for (const [t, x] of [[30, 45], [60, 61], [150, 84]]) {
    const before = structuredClone(edit);
    edit = writeV2ItemTransformAt(edit, { itemId: 'subject', t, patch: { x } });
    assert.equal(item(edit).keyframes.find(point => point.t === t).transform.x, x);
    assert.equal(item(edit).transform.x, 45);
    assert.equal(evaluatedItemTransform(item(edit), t).x, x);
    const after = structuredClone(edit);
    const history = new AkariEditHistoryService();
    history.push({ label: '変形', undo: async () => { edit = before; }, redo: async () => { edit = after; } });
    await history.undo();
    assert.deepEqual(edit, before);
    await history.redo();
    assert.deepEqual(edit, after);
  }
});

test('sequential preview patches resolve against the latest document without losing either item', () => {
  const edit = document('html');
  edit.sources.push({ id: 'still', path: 'assets/still.png' });
  edit.tracks.push({ id: 'cut', lane: 'visual', items: [{ ...document('media').tracks[0].items[0], id: 'still' }] });
  for (const value of [edit.tracks[0].items[0], edit.tracks[1].items[0]]) {
    value.keyframes = [{ t: 0, transform: { x: 32, y: -18, scale: 1.1, rotate: 21 } },
      { t: 180, transform: { x: 32, y: -18, scale: 1.1, rotate: 21 } }];
  }
  const first = resolvePreviewItemWrite(JSON.stringify(edit), {
    kind: 'overlay', itemId: 'subject', playheadSeconds: 1, patch: { transform: { x: 55 } }
  });
  const second = resolvePreviewItemWrite(first.candidateText, {
    kind: 'cut', itemId: 'still', legacyIndex: 0, playheadSeconds: 1,
    patch: { transform: { x: 78 } }
  });
  const result = JSON.parse(second.candidateText);
  assert.equal(result.tracks[0].items[0].keyframes.find(point => point.t === 30).transform.x, 55);
  assert.equal(result.tracks[1].items[0].keyframes.find(point => point.t === 30).transform.x, 78);
  const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const start = source.indexOf("id: 'akari.annotations.commitPreviewTransform'");
  const end = source.indexOf('this.toDispose.push(this.contextKeys.onDidChange', start);
  const handler = source.slice(start, end);
  assert.match(handler, /commitEditMutation\('プレビューで変形を変更', doc =>/u);
  assert.match(handler, /resolvePreviewItemWrite\(source, command\)/u);
  assert.doesNotMatch(handler, /expectedBefore|JSON\.stringify\(doc\) !==/u);
});

test('paused playback updates inspector values without republishing preview selection', () => {
  const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const start = source.indexOf('    handlePlaybackTick(request: PreviewPlaybackTick): void {');
  const end = source.indexOf('    protected normalizeUri(', start);
  const handler = source.slice(start, end);
  assert.match(handler, /withEvaluatedTransform\(current/u);
  assert.doesNotMatch(handler, /pushSelectionSnapshot\(/u);
});

test('removing a size point clears its three axes and preserves position', () => {
  let edit = document('html');
  edit = activateV2ItemTransformKeyframe(edit, { itemId: 'subject', t: 0, field: 'x' });
  edit = activateV2ItemTransformKeyframe(edit, { itemId: 'subject', t: 0, field: 'scale' });
  const before = item(edit).keyframes.find(point => point.t === 0).transform;
  assert.equal(before.scaleX, 1.1);
  assert.equal(before.scaleY, 1.1);
  edit = removeV2Keyframe(edit, { itemId: 'subject', property: 'transform.scaleX', t: 0 });
  const after = item(edit).keyframes.find(point => point.t === 0).transform;
  assert.equal(after.scaleX, undefined);
  assert.equal(after.scaleY, undefined);
  assert.equal(after.scale, undefined);
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
});
