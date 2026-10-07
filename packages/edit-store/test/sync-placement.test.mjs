import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCutRanges, buildCaptionTimelineSegments, canRestoreCutRange,
  readInternalEdit, restoreCutRange, splitCutAudio } from '../lib/index.js';

const text = value => `${JSON.stringify(value, null, 2)}\n`;
const video = (id, at, duration, input, output) => ({ id, at, duration,
  source: { kind: 'media', src: 'cam', in: input, out: output } });
const voice = (id, at, duration, input, output) => ({ id, role: 'speech', at, duration,
  source: { kind: 'media', src: 'mic', in: input, out: output } });
const doc = (fps, cam, mic) => ({ version: 2, output: { width: 320, height: 180, fps },
  sources: [{ id: 'cam', path: 'cam.mp4' }, { id: 'mic', path: 'mic.wav' }],
  sync_groups: [{ id: 'take', members: [
    { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0 } ] }],
  tracks: [{ id: 'v', lane: 'visual', items: cam }, { id: 'a', lane: 'audio', items: mic }] });
const cut = (who, input, output) => ({ in: input, out: output, captionId: who, kind: 'row', label: '行' });

function frameSkewErrors(edit, expected) {
  const audio = new Map();
  for (const item of edit.tracks[1].items) {
    const speed = (item.source.out - item.source.in) / item.duration;
    for (let k = 0; k < item.duration; k++) audio.set(item.at + k, item.source.in + (k + 0.5) * speed);
  }
  let checked = 0;
  let errors = 0;
  for (const item of edit.tracks[0].items) {
    const speed = (item.source.out - item.source.in) / item.duration;
    for (let k = 0; k < item.duration; k++) {
      const heard = audio.get(item.at + k);
      if (heard === undefined) continue;
      checked++;
      if (Math.abs(heard - item.source.in - (k + 0.5) * speed - expected) * edit.output.fps > 1.01) errors++;
    }
  }
  assert.ok(checked > 0);
  assert.equal(errors, 0);
}

function slide(fps, seconds, placement) {
  const shift = Math.round(seconds * fps);
  if (placement === 'trim') return doc(fps,
    [video('cam-0', 0, 60 * fps, 0, 60)], [voice('mic-0', 0, 60 * fps, seconds, 60 + seconds)]);
  if (placement === 'camRight') return doc(fps,
    [video('cam-0', shift, 60 * fps, 0, 60)], [voice('mic-0', 0, 60 * fps + shift, 0, 60 + seconds)]);
  return doc(fps, [video('cam-0', 0, 60 * fps, 0, 60)],
    [voice('mic-0', shift, 60 * fps - shift, 0, 60 - seconds)]);
}

test('offset 0 の組を実配置で合わせた 3 通り×3 秒数は両方の行カットと字幕でずれない', () => {
  for (const placement of ['trim', 'camRight', 'micRight']) for (const seconds of [0.2, 0.5, 2]) {
    const before = slide(30, seconds, placement);
    const offset = placement === 'micRight' ? -seconds : seconds;
    const original = text(before);
    frameSkewErrors(before, offset);
    const mic = before.tracks[1].items[0];
    const sourceTime = 10;
    const heardAt = mic.at / 30 + (sourceTime - mic.source.in) * mic.duration
      / (mic.source.out - mic.source.in) / 30;
    const internal = readInternalEdit(original);
    const segment = buildCaptionTimelineSegments([], internal, { fps: 30 })
      .find(row => row.src === 'mic' && row.in <= sourceTime && sourceTime < row.out);
    assert.ok(segment, `${placement} ${seconds}: caption segment`);
    assert.ok(Math.abs(segment.outStart + (sourceTime - segment.in) / (segment.speed ?? 1) - heardAt) < 1 / 30,
      `${placement} ${seconds}: caption at audible time`);
    for (const who of ['mic', 'cam']) {
      const range = cut(who, 10, 10.4);
      const result = applyCutRanges(original, [range]);
      assert.ok(result.removedFrames > 0, `${placement} ${seconds} ${who}`);
      frameSkewErrors(JSON.parse(result.source), offset);
      assert.equal(restoreCutRange(result.source, range).source, original,
        `${placement} ${seconds} ${who}: restore`);
    }
  }
});

test('映像より先に声が始まるとき、映像内は切れて声だけの前半は理由つきで断る', () => {
  const original = text(doc(30, [video('cam-0', 30, 300, 1, 11)],
    [voice('mic-0', 0, 330, 0, 11)]));
  for (const who of ['mic', 'cam']) {
    const range = cut(who, 3.123, 4.057);
    const result = applyCutRanges(original, [range]);
    assert.ok(result.removedFrames > 0);
    const after = JSON.parse(result.source);
    assert.ok(after.tracks.every(track => track.items.every(item => item.at >= 0)));
    frameSkewErrors(after, 0);
  }
  const outside = applyCutRanges(original, [cut('mic', 0.2, 0.6)]);
  assert.equal(outside.source, original);
  assert.equal(outside.removedFrames, 0);
  assert.match(outside.warnings[0], /同期した映像がこの区間にない/);
});

test('映像の途中の隙間と実秒境界でも声の配置を保ち復元できる', () => {
  const cases = [
    doc(30, [video('cam-0', 30, 300, 0, 10)], [voice('mic-0', 30, 300, 0.0123, 10.0123)]),
    doc(30, [video('cam-0', 0, 150, 0, 5), video('cam-1', 180, 150, 6, 11)],
      [voice('mic-0', 0, 330, 0, 11)]),
  ];
  for (const [index, value] of cases.entries()) {
    const original = text(value);
    const range = cut('mic', index === 0 ? 3.123 : 7.123, index === 0 ? 4.057 : 8.057);
    const result = applyCutRanges(original, [range]);
    frameSkewErrors(JSON.parse(result.source), index === 0 ? 0.0123 : 0);
    assert.equal(restoreCutRange(result.source, range).source, original);
  }
});

test('実秒の声端を 24/30/60 fps で切っても声の片は重ならず隙間も作らない', () => {
  for (const fps of [24, 30, 60]) for (const extra of [0.001, 0.004, 0.0123]) {
    const original = text(doc(fps, [video('cam-0', 0, 10 * fps, 0, 10)],
      [voice('mic-0', 0, 10 * fps, extra, 10 + extra)]));
    const after = JSON.parse(applyCutRanges(original, [cut('mic', 3.123 + extra, 4.057 + extra)]).source);
    const pieces = after.tracks[1].items.sort((a, b) => a.at - b.at);
    for (let i = 1; i < pieces.length; i++) {
      assert.equal(pieces[i].at, pieces[i - 1].at + pieces[i - 1].duration,
        `${fps} fps, ${extra} sec`);
    }
  }
});

test('分離音声のある映像の頭・尻をまたぐカットは戻せなければ理由を返す', () => {
  for (const [cam, range] of [
    [[video('cam-0', 0, 294, 0.2, 10)], cut('mic', 0, 0.9)],
    [[video('cam-0', 0, 300, 0, 10)], cut('mic', 9.5, 10.4)],
  ]) {
    const value = doc(30, cam, cam.map(item => voice('mic-0', item.at, item.duration,
      item.source.in, item.source.out)));
    const linked = splitCutAudio(value, { cutId: 'cam-0', hasAudio: true }).document;
    const applied = applyCutRanges(text(linked), [range]);
    assert.match(canRestoreCutRange(applied.source, range), /戻せません/);
    const restored = restoreCutRange(applied.source, range);
    assert.equal(restored.restored, false);
    assert.equal(restored.source, applied.source);
  }
});

test('ジャンプカットの両側を編集済みなら映像が重なる復元を断る', () => {
  const value = doc(24, [
    { ...video('cam-0', 0, 134, 1, 6.583333333333334),
      cut_edge: { in: 1, out: 6.791666666666667, at: 0 } },
    { ...video('cam-1', 134, 71, 8.046833333333334, 11.005166666666666),
      cut_edge: { in: 7.5885, out: 11.005166666666666, at: 134 } },
  ], [
    { ...voice('mic-0', 0, 134, 2.2345, 7.817865467625898),
      cut_edge: { in: 2.2345, out: 8.0262, at: 0 } },
    { ...voice('mic-1', 134, 71, 9.28133780487805, 12.2397),
      cut_edge: { in: 8.823, out: 12.2397, at: 134 } },
  ]);
  value.sync_groups[0].members[1].offset_sec = 1.2345;
  const source = text(value);
  const range = { ...cut('mic', 7.817865467625898, 9.28133780487805),
    kind: 'filler', reason: 'word', label: 'えー' };
  assert.match(canRestoreCutRange(source, range), /戻せません/);
  const restored = restoreCutRange(source, range);
  assert.equal(restored.restored, false);
  assert.equal(restored.source, source);
});

test('行カットで残った映像と声に reason を付けない', () => {
  const original = text(doc(30, [video('cam-0', 0, 300, 0, 10)],
    [voice('mic-0', 0, 300, 0, 10)]));
  const after = JSON.parse(applyCutRanges(original, [cut('mic', 3, 4)]).source);
  assert.ok(after.tracks.flatMap(track => track.items).every(item => !Object.hasOwn(item, 'reason')));
});
