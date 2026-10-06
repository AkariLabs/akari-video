import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTimelineMap, closeGapAt, compactTrackGaps, editPoints, evaluateEnvelopeDb, extractRange, findGapAt,
  liftRange, readEditV2, resolveTrackRippleMode, rippleDeleteItems, rippleTrimToPlayhead,
  setTrackRippleMode, sourceToOutput, splitAtFrame,
} from '../lib/index.js';

const fps = 30;
const media = (id, at, duration, sourceIn = at / fps) => ({
  id, at, duration, source: { kind: 'media', src: 'video', in: sourceIn, out: sourceIn + duration / fps },
});
const audio = (id, at, duration, role = 'sfx') => ({
  id, at, duration, role, source: { kind: 'media', src: 'sound', in: at / fps, out: (at + duration) / fps },
});
const fixture = () => ({
  version: 2, output: { width: 1920, height: 1080, fps },
  sources: [{ id: 'video', path: 'video.mp4' }, { id: 'sound', path: 'sound.wav' }],
  tracks: [
    { id: 'sfx', lane: 'audio', items: [audio('effect', 180, 240)] },
    { id: 'bgm', lane: 'audio', items: [audio('music', 0, 600, 'bgm')] },
    { id: 'main', lane: 'visual', items: [media('story', 0, 600)] },
    { id: 'title', lane: 'visual', items: [{ id: 'telop', at: 180, duration: 240, source: { kind: 'telop', preset: 'plain' } }] },
    { id: 'broll', lane: 'visual', items: [media('insert', 300, 180, 10)] },
  ],
});
const track = (edit, id) => edit.tracks.find(entry => entry.id === id);
const spans = (edit, id) => track(edit, id).items.map(item => [item.at, item.duration]);

test('default modes, 8s–12s extraction, source mapping, and input immutability', () => {
  const input = fixture();
  const before = structuredClone(input);
  assert.deepEqual(input.tracks.map(resolveTrackRippleMode), ['cut', 'fixed', 'cut', 'cut', 'cut']);
  const result = extractRange(input, { start: 240, end: 360 });
  assert.equal(result.changed, true);
  assert.equal(result.removedFrames, 120);
  assert.deepEqual(spans(result.edit, 'main'), [[0, 240], [240, 240]]);
  assert.deepEqual(spans(result.edit, 'title'), [[180, 60], [240, 60]]);
  assert.deepEqual(spans(result.edit, 'broll'), [[240, 120]]);
  assert.deepEqual(spans(result.edit, 'sfx'), [[180, 60], [240, 60]]);
  assert.deepEqual(track(result.edit, 'bgm'), track(input, 'bgm'));
  const cuts = track(result.edit, 'main').items.map(item => ({ ...item.source, at: item.at / fps }));
  assert.equal(sourceToOutput(buildTimelineMap(cuts, { fps }).segments, 13), 9);
  assert.deepEqual(input, before);
  assert.doesNotThrow(() => readEditV2(result.edit));
});

test('override all cut or only main cut; locked tracks stay fixed', () => {
  const edit = fixture();
  const all = extractRange(edit, { start: 240, end: 360 }, { modeOverride: { bgm: 'cut' } });
  assert.deepEqual(spans(all.edit, 'bgm'), [[0, 240], [240, 240]]);
  const mainOnly = extractRange(edit, { start: 240, end: 360 }, {
    modeOverride: { title: 'fixed', broll: 'fixed', sfx: 'fixed' },
  });
  assert.deepEqual(spans(mainOnly.edit, 'main'), [[0, 240], [240, 240]]);
  for (const id of ['title', 'broll', 'sfx', 'bgm']) assert.deepEqual(track(mainOnly.edit, id), track(edit, id));
  const locked = extractRange(edit, { start: 240, end: 360 }, { lockedTrackIds: ['main', 'title'] });
  for (const id of ['main', 'title']) assert.deepEqual(track(locked.edit, id), track(edit, id));
});

test('shift collision reports blocked without overlaps and leaves anchors to refresh', () => {
  const edit = fixture();
  track(edit, 'title').target = false;
  track(edit, 'title').sync = true;
  track(edit, 'title').items = [
    { id: 'earlier', at: 0, duration: 300, source: { kind: 'telop', preset: 'plain' } },
    { id: 'later', at: 360, duration: 120, source: { kind: 'telop', preset: 'plain' } },
    { id: 'anchored', at: 500, duration: 30, anchor: { caption: 'c-1' }, source: { kind: 'telop', preset: 'plain' } },
  ];
  const result = extractRange(edit, { start: 240, end: 360 });
  assert.deepEqual(result.blocked, ['later']);
  assert.deepEqual(spans(result.edit, 'title'), [[0, 300], [300, 120], [500, 30]]);
  const ordered = [...track(result.edit, 'title').items].sort((a, b) => a.at - b.at);
  let overlaps = 0;
  for (let left = 0; left < ordered.length; left++) {
    for (let right = left + 1; right < ordered.length; right++) {
      if (Math.max(ordered[left].at, ordered[right].at)
        < Math.min(ordered[left].at + ordered[left].duration, ordered[right].at + ordered[right].duration)) overlaps++;
    }
  }
  assert.equal(overlaps, 0);
});

test('linked visual and audio split together with paired links', () => {
  const edit = fixture();
  track(edit, 'main').items[0].audio = false;
  track(edit, 'sfx').items = [{ ...audio('speech', 0, 600, 'speech'), link: 'story' }];
  const result = splitAtFrame(edit, 300, { itemIds: ['story'] });
  assert.equal(result.changed, true);
  assert.deepEqual(spans(result.edit, 'main'), [[0, 300], [300, 300]]);
  assert.deepEqual(spans(result.edit, 'sfx'), [[0, 300], [300, 300]]);
  const [leftVideo, rightVideo] = track(result.edit, 'main').items;
  const [leftAudio, rightAudio] = track(result.edit, 'sfx').items;
  assert.equal(leftAudio.link, leftVideo.id);
  assert.equal(rightAudio.link, rightVideo.id);
  assert.notEqual(leftAudio.id, rightAudio.id);
  const fromAudio = splitAtFrame(edit, 300, { itemIds: ['speech'] });
  assert.deepEqual(spans(fromAudio.edit, 'main'), [[0, 300], [300, 300]]);
  assert.equal(track(fromAudio.edit, 'sfx').items[1].link, track(fromAudio.edit, 'main').items[1].id);
});

test('range deletion keeps both linked audio pieces paired with the matching visual pieces', () => {
  const edit = fixture();
  track(edit, 'sfx').items = [{ ...audio('speech', 0, 600, 'speech'), link: 'story' }];
  for (const operation of [liftRange, extractRange]) {
    const result = operation(edit, { start: 240, end: 360 });
    const [leftVideo, rightVideo] = track(result.edit, 'main').items;
    const [leftAudio, rightAudio] = track(result.edit, 'sfx').items;
    assert.equal(leftAudio.link, leftVideo.id);
    assert.equal(rightAudio.link, rightVideo.id);
    assert.deepEqual(edit.tracks.find(row => row.id === 'sfx').items[0].link, 'story');
  }
});

test('audio source speed, gain envelope and fades survive a split within 1e-6', () => {
  const edit = fixture();
  track(edit, 'sfx').items = [{ ...audio('effect', 0, 300),
    source: { kind: 'media', src: 'sound', in: 2, out: 22, speed: 2 },
    gain_db: -3, fade_in: 0.4, fade_out: 0.6, ducking: true,
    keyframes: [{ t: 0, gain_db: -12 }, { t: 150, gain_db: 0 }, { t: 300, gain_db: -6 }],
  }];
  const result = splitAtFrame(edit, 120, { itemIds: ['effect'] });
  assert.equal(result.changed, true);
  const [left, right] = track(result.edit, 'sfx').items;
  assert.equal(left.source.out, right.source.in);
  assert.equal(left.source.out, 10);
  assert.equal(left.fade_in, 0.4);
  assert.equal(left.fade_out, undefined);
  assert.equal(right.fade_in, undefined);
  assert.equal(right.fade_out, 0.6);
  assert.equal(left.ducking && right.ducking, true);
  const gain = (item, t) => evaluateEnvelopeDb(item.keyframes.map(key => ({ t: key.t, gainDb: key.gain_db })), t);
  const original = track(edit, 'sfx').items[0];
  for (let frame = 0; frame <= 300; frame++) {
    const piece = frame <= 120 ? left : right;
    const local = frame <= 120 ? frame : frame - 120;
    assert.ok(Math.abs(gain(original, frame) - gain(piece, local)) <= 1e-6, `frame ${frame}`);
  }
});

test('splitting audio removes the fade shape from the side without that fade', () => {
  const edit = fixture();
  track(edit, 'bgm').items[0] = { ...track(edit, 'bgm').items[0],
    fade_in: 0.5, fade_in_shape: 's_curve', fade_out: 0.5, fade_out_shape: 'slow' };
  const result = splitAtFrame(edit, 300, { itemIds: ['music'] });
  const [left, right] = track(result.edit, 'bgm').items;
  assert.deepEqual([left.fade_in, left.fade_in_shape, left.fade_out, left.fade_out_shape],
    [0.5, 's_curve', undefined, undefined]);
  assert.deepEqual([right.fade_in, right.fade_in_shape, right.fade_out, right.fade_out_shape],
    [undefined, undefined, 0.5, 'slow']);
  assert.doesNotThrow(() => readEditV2(result.edit));
});

test('removing the tail also removes its fade-out shape', () => {
  const edit = fixture();
  track(edit, 'sfx').items[0].fade_out = 0.5;
  track(edit, 'sfx').items[0].fade_out_shape = 's_curve';
  const result = liftRange(edit, { start: 300, end: 420 });
  const left = track(result.edit, 'sfx').items[0];
  assert.equal(left.fade_out, undefined);
  assert.equal(left.fade_out_shape, undefined);
  assert.doesNotThrow(() => readEditV2(result.edit));
});

test('nonlinear gain boundary follows the incoming key easing', () => {
  const edit = fixture();
  track(edit, 'sfx').items = [{ ...audio('effect', 0, 300),
    keyframes: [{ t: 0, gain_db: -12 }, { t: 300, gain_db: 0, easing: 'in-quad' }],
  }];
  const result = splitAtFrame(edit, 120, { itemIds: ['effect'] });
  const [left, right] = track(result.edit, 'sfx').items;
  const originalAtBoundary = evaluateEnvelopeDb([
    { t: 0, gainDb: -12 }, { t: 300, gainDb: 0, easing: 'in-quad' },
  ], 120);
  assert.ok(Math.abs(originalAtBoundary - (-10.08)) <= 1e-6);
  assert.ok(Math.abs(left.keyframes.at(-1).gain_db - originalAtBoundary) <= 1e-6);
  assert.ok(Math.abs(right.keyframes[0].gain_db - originalAtBoundary) <= 1e-6);
  assert.equal(left.keyframes.at(-1).easing, 'in-quad');
});

test('per-property easing controls visual boundary values', () => {
  const edit = fixture();
  track(edit, 'main').items[0].keyframes = [
    { t: 0, opacity: 0, transform: { x: 0 }, easing: { opacity: 'linear' } },
    { t: 600, opacity: 1, transform: { x: 600 },
      easing: { opacity: 'out-quad', 'transform.x': 'in-quad' } },
  ];
  const result = splitAtFrame(edit, 300, { itemIds: ['story'] });
  const [left, right] = track(result.edit, 'main').items;
  assert.equal(left.keyframes.at(-1).opacity, 0.75);
  assert.equal(left.keyframes.at(-1).transform.x, 150);
  assert.deepEqual(left.keyframes.at(-1).easing, { opacity: 'out-quad', 'transform.x': 'in-quad' });
  assert.equal(right.keyframes[0].opacity, 0.75);
  assert.equal(right.keyframes[0].transform.x, 150);
});

test('visual keyframes are rebased with an interpolated boundary point', () => {
  const edit = fixture();
  track(edit, 'main').items[0].keyframes = [
    { t: 0, opacity: 0, transform: { x: 0 } },
    { t: 600, opacity: 1, transform: { x: 600 } },
  ];
  const result = splitAtFrame(edit, 300, { itemIds: ['story'] });
  const [left, right] = track(result.edit, 'main').items;
  assert.deepEqual(left.keyframes.at(-1), { t: 300, opacity: 0.5, transform: { x: 300 } });
  assert.deepEqual(right.keyframes[0], { t: 0, opacity: 0.5, transform: { x: 300 } });
});

test('splitting an html parent clips and rebases its explicit children', () => {
  const edit = fixture();
  track(edit, 'title').items = [{
    id: 'panel', at: 0, duration: 600, source: { kind: 'html', path: 'panel.html' },
    items: [media('child', 240, 240, 8)],
  }];
  const result = splitAtFrame(edit, 300, { itemIds: ['panel'] });
  const [left, right] = track(result.edit, 'title').items;
  assert.deepEqual(left.items.map(item => [item.at, item.duration]), [[240, 60]]);
  assert.deepEqual(right.items.map(item => [item.at, item.duration]), [[0, 180]]);
  assert.notEqual(left.items[0].id, right.items[0].id);
  assert.doesNotThrow(() => readEditV2(result.edit));
});

test('lift keeps gap; anchored cut item is removed inside range', () => {
  const edit = fixture();
  track(edit, 'title').items[0].anchor = { caption: 'c-1' };
  const result = liftRange(edit, { start: 240, end: 360 });
  assert.deepEqual(spans(result.edit, 'main'), [[0, 240], [360, 240]]);
  assert.deepEqual(spans(result.edit, 'title'), [[180, 60], [360, 60]]);
  assert.equal(result.removedFrames, undefined);
});

test('gap discovery and closure include leading and middle, exclude trailing', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 60, 90), media('second', 210, 90)];
  assert.deepEqual(findGapAt(edit, 'main', 10), { start: 0, end: 60 });
  assert.deepEqual(findGapAt(edit, 'main', 180), { start: 150, end: 210 });
  assert.equal(findGapAt(edit, 'main', 300), undefined);
  assert.deepEqual(spans(closeGapAt(edit, 'main', 10).edit, 'main'), [[0, 90], [150, 90]]);
  assert.deepEqual(spans(closeGapAt(edit, 'main', 180).edit, 'main'), [[60, 90], [150, 90]]);
  assert.equal(closeGapAt(edit, 'main', 300).changed, false);
});

test('ripple trim prev/next uses nearest edit points and no-point reason', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 0, 150), media('second', 150, 150)];
  for (const id of ['title', 'broll', 'sfx']) track(edit, id).target = false;
  assert.deepEqual(editPoints(edit), [0, 150, 300]);
  assert.equal(rippleTrimToPlayhead(edit, 180, 'prev').removedFrames, 30);
  assert.equal(rippleTrimToPlayhead(edit, 180, 'next').removedFrames, 120);
  assert.match(rippleTrimToPlayhead(edit, 0, 'prev').reason, /編集点/);
});

test('minimum split length rejects atomically', () => {
  const edit = fixture();
  const result = splitAtFrame(edit, 2, { itemIds: ['story'] });
  assert.equal(result.changed, false);
  assert.match(result.reason, /最小尺/);
  assert.deepEqual(result.edit, edit);
});

test('a locked linked audio track rejects the entire split with a reason', () => {
  const edit = fixture();
  track(edit, 'main').items[0].audio = false;
  track(edit, 'sfx').items = [{ ...audio('speech', 0, 600, 'speech'), link: 'story' }];
  const before = structuredClone(edit);
  const result = splitAtFrame(edit, 300, { itemIds: ['story'], lockedTrackIds: ['sfx'] });
  assert.equal(result.changed, false);
  assert.match(result.reason, /固定中/);
  assert.deepEqual(result.edit, before);
  assert.deepEqual(edit, before);
});

test('item ripple deletion shifts other cut tracks without deleting their content', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 0, 150), media('second', 150, 150), media('third', 300, 150)];
  track(edit, 'title').items.push({ id: 'later-title', at: 600, duration: 60, source: { kind: 'telop', preset: 'plain' } });
  const result = rippleDeleteItems(edit, ['second']);
  assert.deepEqual(spans(result.edit, 'main'), [[0, 150], [150, 150]]);
  assert.deepEqual(spans(result.edit, 'title'), [[180, 240], [450, 60]]);
  assert.deepEqual(track(result.edit, 'bgm'), track(edit, 'bgm'));
});

test('linked deletion runs once per shared interval and oneSide unlinks the survivor', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 0, 150), media('second', 150, 150), media('third', 300, 150)];
  track(edit, 'main').items[1].audio = false;
  track(edit, 'sfx').items = [{ ...audio('paired', 150, 150, 'speech'), link: 'second' }];
  const paired = rippleDeleteItems(edit, ['second']);
  assert.deepEqual(spans(paired.edit, 'main'), [[0, 150], [150, 150]]);
  assert.equal(track(paired.edit, 'sfx').items.length, 0);
  assert.equal(paired.removedFrames, 150);
  const oneSide = rippleDeleteItems(edit, ['second'], { oneSide: true });
  assert.equal(track(oneSide.edit, 'sfx').items[0].link, undefined);
  assert.equal(track(oneSide.edit, 'sfx').items[0].at, 150);
});

test('separate selections have the same result as right-to-left deletion', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 0, 90), media('second', 90, 90), media('third', 180, 90), media('fourth', 270, 90)];
  const together = rippleDeleteItems(edit, ['second', 'fourth']);
  const right = rippleDeleteItems(edit, ['fourth']);
  const left = rippleDeleteItems(right.edit, ['second']);
  assert.deepEqual(together.edit, left.edit);
});

test('compact media gaps only, preserving non-media and selected prefix', () => {
  const edit = fixture();
  track(edit, 'main').items = [media('first', 30, 90), media('second', 180, 90), media('third', 330, 90)];
  const full = compactTrackGaps(edit);
  assert.deepEqual(spans(full.edit, 'main'), [[0, 90], [90, 90], [180, 90]]);
  const selected = compactTrackGaps(edit, { fromItemId: 'first' });
  assert.deepEqual(spans(selected.edit, 'main'), [[30, 90], [120, 90], [210, 90]]);
  assert.deepEqual(track(full.edit, 'title'), track(edit, 'title'));
});

test('track mode setter persists the two switches without mutating input', () => {
  const edit = fixture();
  for (const [mode, target, sync] of [['cut', true, true], ['shift', false, true], ['fixed', false, false]]) {
    const result = setTrackRippleMode(edit, 'main', mode);
    assert.equal(track(result, 'main').target, target);
    assert.equal(track(result, 'main').sync, sync);
    assert.equal(resolveTrackRippleMode(track(result, 'main')), mode);
    assert.equal(track(edit, 'main').target, undefined);
    assert.doesNotThrow(() => readEditV2(result));
  }
});

test('every edit-returning ripple operation preserves its input', () => {
  const cases = [
    ['splitAtFrame', () => {}, edit => splitAtFrame(edit, 300, { itemIds: ['story'] })],
    ['liftRange', () => {}, edit => liftRange(edit, { start: 240, end: 360 })],
    ['extractRange', () => {}, edit => extractRange(edit, { start: 240, end: 360 })],
    ['rippleDeleteItems', () => {}, edit => rippleDeleteItems(edit, ['story'])],
    ['closeGapAt', edit => {
      track(edit, 'main').items = [media('first', 60, 90), media('second', 210, 90)];
    }, edit => closeGapAt(edit, 'main', 10)],
    ['rippleTrimToPlayhead', () => {}, edit => rippleTrimToPlayhead(edit, 270, 'prev')],
    ['compactTrackGaps', () => {}, edit => compactTrackGaps(edit)],
    ['setTrackRippleMode', () => {}, edit => setTrackRippleMode(edit, 'main', 'shift')],
  ];
  for (const [name, prepare, run] of cases) {
    const edit = fixture();
    prepare(edit);
    const snapshot = structuredClone(edit);
    run(edit);
    assert.deepEqual(edit, snapshot, name);
  }
});
