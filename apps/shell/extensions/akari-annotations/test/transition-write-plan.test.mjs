import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chooseTransitionAlign, planTrackTransitions } from '@akari-video/edit-store';
import { mergeTransitionDeclaration, placeBoundary, boundaryBandGeometry } from '../lib/common/transition-boundary-model.js';
import { transitionMaterialDuration } from '../lib/common/transition-write-plan.js';
import { decideTransitionWrite } from '../lib/common/transition-fill-write.js';

test('material duration input distinguishes missing URI, pending, unavailable, and known length', () => {
  for (const [videoUri, cached, expected] of [
    [undefined, undefined, undefined], [undefined, 'unavailable', undefined],
    [undefined, 10, undefined], ['clip.mp4', undefined, undefined],
    ['clip.mp4', 'pending', undefined], ['clip.mp4', 'unavailable', undefined],
    ['clip.mp4', 10, 10]
  ]) {
    assert.equal(transitionMaterialDuration({ videoUri, cached, outSeconds: 5 }), expected);
  }
});

test('unknown material keeps the declared outgoing window without showing a freeze estimate', () => {
  const duration = transitionMaterialDuration({ videoUri: 'clip.mp4', cached: 'unavailable', outSeconds: 5 });
  const plan = planTrackTransitions([
    { id: 'a', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 0,
      tailRoomSeconds: duration, transitionOut: { declaredSeconds: 0.5, align: 'after-cut', fill: false } },
    { id: 'b', startSeconds: 5, lengthSeconds: 5, headRoomSeconds: 0, tailRoomSeconds: undefined }
  ], { fps: 30, tailRoom: 'ignore' })[0];
  const placement = placeBoundary(plan);
  assert.equal(placement.state, 'ok');
  assert.equal(placement.effectiveSeconds, 0.5);
  assert.equal(placement.freezeOutgoingUnknown, true);
  assert.equal(placement.freezeOutgoingSeconds, 0);
  assert.equal(boundaryBandGeometry(placement, 100).freezeOutgoingPx, 0);
});

test('a known outgoing shortage uses the declared window and reports its frozen end', () => {
  const plan = planTrackTransitions([
    { id: 'a', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 0, tailRoomSeconds: 0.2,
      transitionOut: { declaredSeconds: 0.5, align: 'after-cut', fill: false } },
    { id: 'b', startSeconds: 5, lengthSeconds: 5, headRoomSeconds: 0, tailRoomSeconds: undefined }
  ], { fps: 30, tailRoom: 'ignore' })[0];
  const placement = placeBoundary(plan);
  assert.equal(placement.state, 'ok');
  assert.equal(placement.effectiveSeconds, 0.5);
  assert.ok(Math.abs(placement.freezeOutgoingSeconds - 0.3) < 1e-9);
  assert.ok(Math.abs(boundaryBandGeometry(placement, 100).freezeOutgoingPx - 30) < 1e-9);
});

const cases = JSON.parse(readFileSync(new URL('../../../../../packages/edit-store/test/transition-plan-cases.json', import.meta.url), 'utf8'));
const room = value => value === 'inf' ? Infinity : value === null ? undefined : value;
const clipOf = clip => ({ id: clip.id, startSeconds: clip.start, lengthSeconds: clip.length,
  headRoomSeconds: room(clip.head), tailRoomSeconds: room(clip.tail),
  ...(clip.out ? { transitionOut: { declaredSeconds: clip.out.declared,
    align: clip.out.align, fill: clip.out.fill === true } } : {}) });

for (const entry of cases.choose) {
  test(`recommended position: ${entry.name}`, () => {
    const clips = entry.clips.map(clipOf);
    const choice = chooseTransitionAlign(clips, entry.earlier, entry.declared,
      { fps: entry.fps, allowFill: false });
    assert.equal(choice.align, entry.expected.align);
    assert.ok(Math.abs(choice.plan.effectiveSeconds - entry.expected.effective) < 1e-9);
    const written = decideTransitionWrite({ clips, earlierId: entry.earlier, fps: entry.fps,
      request: { type: 'fade', duration: entry.declared, align: choice.align } });
    assert.equal(written.patch.align, choice.align === 'center' ? undefined : choice.align);
    assert.equal(written.patch.duration, entry.declared);
  });
}

test('changing type keeps a known or unknown position; buttons replace it and center clears it', () => {
  const clips = [
    { id: 'a', startSeconds: 0, lengthSeconds: 4, headRoomSeconds: 1, tailRoomSeconds: 2 },
    { id: 'b', startSeconds: 4, lengthSeconds: 4, headRoomSeconds: 1, tailRoomSeconds: 2 }
  ];
  for (const existingAlign of ['before-cut', 'future-side']) {
    const write = decideTransitionWrite({ clips, earlierId: 'a', fps: 30,
      existing: { type: 'fade', duration: 0.5, align: existingAlign },
      request: { type: 'dissolve', duration: 0.5 } });
    assert.equal(write.patch.align, undefined);
    assert.equal(mergeTransitionDeclaration({ type: 'fade', duration: 0.5, align: existingAlign },
      write.patch).align, existingAlign);
  }
  const existing = { type: 'fade', duration: 0.5, align: 'future-side' };
  const moved = decideTransitionWrite({ clips, earlierId: 'a', fps: 30, existing,
    request: { type: 'fade', duration: 0.5, align: 'after-cut' } });
  assert.equal(moved.patch.align, 'after-cut');
  const centered = decideTransitionWrite({ clips, earlierId: 'a', fps: 30, existing,
    request: { type: 'fade', duration: 0.5, align: null } });
  assert.equal(centered.patch.align, null);
  assert.equal('align' in mergeTransitionDeclaration({ type: 'fade', duration: 0.5, align: 'future-side' },
    centered.patch), false);
});

test('material shortage does not shorten the saved duration', () => {
  const clips = [
    { id: 'a', startSeconds: 0, lengthSeconds: 0.2, headRoomSeconds: 0, tailRoomSeconds: 0.2 },
    { id: 'b', startSeconds: 0.2, lengthSeconds: 0.2, headRoomSeconds: 0.2, tailRoomSeconds: 0 }
  ];
  const material = decideTransitionWrite({ clips, earlierId: 'a', fps: 30,
    request: { type: 'fade', duration: 0.5, align: 'before-cut' } });
  assert.equal(material.patch.duration, 0.5);
  const absent = decideTransitionWrite({ clips: clips.map((clip, index) => index === 1
    ? { ...clip, headRoomSeconds: 0 } : clip), earlierId: 'a', fps: 30,
    request: { type: 'fade', duration: 0.5, align: 'before-cut' } });
  assert.equal(absent.patch.duration, 0.5);
  const longMaterial = clips.map(clip => ({ ...clip, headRoomSeconds: 2, tailRoomSeconds: 2 }));
  assert.equal(planTrackTransitions([{ ...longMaterial[0], transitionOut: {
    declaredSeconds: 0.5, align: 'center', fill: false } }, longMaterial[1]], { fps: 30 })[0].state,
    'shortened');
  assert.equal(decideTransitionWrite({ clips: longMaterial, earlierId: 'a', fps: 30,
    request: { type: 'fade', duration: 0.5, align: 'center' } }).patch.duration, 0.5);
});
