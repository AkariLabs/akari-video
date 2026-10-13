import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chooseTransitionAlign, planTrackTransitions } from '@akari-video/edit-store';
import { mergeTransitionDeclaration } from '../lib/common/transition-boundary-model.js';
import { transitionWritePlan, transitionMaterialDuration } from '../lib/common/transition-write-plan.js';

test('material duration input distinguishes missing URI, pending, unavailable, and known length', () => {
  for (const [videoUri, cached, expected] of [
    [undefined, undefined, undefined], [undefined, 'unavailable', undefined],
    [undefined, 10, undefined], ['clip.mp4', undefined, undefined],
    ['clip.mp4', 'pending', undefined], ['clip.mp4', 'unavailable', 5],
    ['clip.mp4', 10, 10]
  ]) {
    assert.equal(transitionMaterialDuration({ videoUri, cached, outSeconds: 5 }), expected);
  }
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
    const written = transitionWritePlan({ clips, earlierId: entry.earlier,
      duration: entry.declared, fps: entry.fps, explicitAlign: choice.align });
    assert.equal(written.align, choice.align === 'center' ? null : choice.align);
  });
}

test('changing type keeps a known or unknown position; buttons replace it and center clears it', () => {
  const clips = [
    { id: 'a', startSeconds: 0, lengthSeconds: 4, headRoomSeconds: 1, tailRoomSeconds: 2 },
    { id: 'b', startSeconds: 4, lengthSeconds: 4, headRoomSeconds: 1, tailRoomSeconds: 2 }
  ];
  for (const existingAlign of ['before-cut', 'future-side']) {
    const write = transitionWritePlan({ clips, earlierId: 'a', duration: 0.5, fps: 30, existingAlign });
    assert.equal(write.align, undefined);
    assert.equal(mergeTransitionDeclaration({ type: 'fade', duration: 0.5, align: existingAlign },
      { type: 'dissolve', duration: write.duration }).align, existingAlign);
  }
  const moved = transitionWritePlan({ clips, earlierId: 'a', duration: 0.5, fps: 30,
    existingAlign: 'future-side', explicitAlign: 'after-cut' });
  assert.equal(moved.align, 'after-cut');
  const centered = transitionWritePlan({ clips, earlierId: 'a', duration: 0.5, fps: 30,
    existingAlign: 'future-side', explicitAlign: null });
  assert.equal(centered.align, null);
  assert.equal('align' in mergeTransitionDeclaration({ type: 'fade', duration: 0.5, align: 'future-side' },
    { type: 'fade', duration: centered.duration, align: centered.align }), false);
});

test('only material shortage shortens the saved duration', () => {
  const clips = [
    { id: 'a', startSeconds: 0, lengthSeconds: 0.2, headRoomSeconds: 0, tailRoomSeconds: 0.2 },
    { id: 'b', startSeconds: 0.2, lengthSeconds: 0.2, headRoomSeconds: 0.2, tailRoomSeconds: 0 }
  ];
  const material = transitionWritePlan({ clips, earlierId: 'a', duration: 0.5, fps: 30,
    explicitAlign: 'before-cut' });
  assert.equal(material.duration, 0.2);
  assert.equal(material.roomOutcome, 'clamped');
  const absent = transitionWritePlan({ clips: clips.map((clip, index) => index === 1
    ? { ...clip, headRoomSeconds: 0 } : clip), earlierId: 'a', duration: 0.5,
    fps: 30, explicitAlign: 'before-cut' });
  assert.equal(absent.roomOutcome, 'none');
  assert.equal(absent.duration, 0.5);
  const longMaterial = clips.map(clip => ({ ...clip, headRoomSeconds: 2, tailRoomSeconds: 2 }));
  assert.equal(planTrackTransitions([{ ...longMaterial[0], transitionOut: {
    declaredSeconds: 0.5, align: 'center', fill: false } }, longMaterial[1]], { fps: 30 })[0].state,
    'shortened');
  assert.equal(transitionWritePlan({ clips: longMaterial, earlierId: 'a', duration: 0.5,
    fps: 30, explicitAlign: 'center' }).duration, 0.5);
});
