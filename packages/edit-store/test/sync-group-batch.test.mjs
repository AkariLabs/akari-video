import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCutRanges, restoreCutRange } from '../lib/index.js';

const source = value => `${JSON.stringify(value, null, 2)}\n`;
const video = (id, at, duration, input, output) => ({ id, at, duration,
  source: { kind: 'media', src: 'cam', in: input, out: output } });
const voice = (id, at, duration, input, output) => ({ id, role: 'speech', at, duration,
  source: { kind: 'media', src: 'mic', in: input, out: output } });
const doc = (cam, mic) => source({ version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'cam', path: 'cam.mp4' }, { id: 'mic', path: 'mic.wav' }],
  sync_groups: [{ id: 'g', members: [{ source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0 }] }],
  tracks: [{ id: 'v', lane: 'visual', items: cam }, { id: 'a', lane: 'audio', items: mic }] });
const cut = (inPoint, outPoint, captionId = 'mic', kind = 'row') => ({
  in: inPoint, out: outPoint, captionId, kind });

test('a row after an earlier filler cut cannot report a partial tail as restored', () => {
  const initial = doc([video('cam-0', 0, 600, 0, 20)], [voice('mic-0', 0, 600, .5, 20.5)]);
  const filler = applyCutRanges(initial, [cut(15.5, 15.9, 'mic', 'filler')]).source;
  const row = applyCutRanges(filler, [cut(14.5, 20.5)]).source;
  const restored = restoreCutRange(row, cut(14.5, 20.5));
  assert.equal(restored.restored, false);
  assert.equal(restored.source, row);
  const shortVoice = doc([video('cam-0', 0, 600, 0, 20)],
    [voice('mic-0', 0, 300, .5, 10.5), voice('mic-1', 300, 60, 10.5, 12.5)]);
  const removed = applyCutRanges(shortVoice, [cut(10, 20, 'cam')]).source;
  assert.equal(restoreCutRange(removed, cut(10, 20, 'cam')).restored, false);
});

test('an internal visual gap survives three cuts and never overlaps the voice', () => {
  let current = doc([video('cam-0', 0, 150, 0, 5), video('cam-1', 175, 300, 5 + 25 / 30, 15 + 25 / 30)],
    [voice('mic-0', 0, 475, 0, 475 / 30)]);
  for (const range of [cut(5.5, 6.5), cut(10, 11), cut(6.5, 7.5)])
    current = applyCutRanges(current, [range]).source;
  const edit = JSON.parse(current);
  const visual = edit.tracks[0].items;
  const audio = edit.tracks[1].items;
  assert.equal(visual[1].at - visual[0].at - visual[0].duration, 25);
  assert.ok(audio.every((item, index) => index === 0 || item.at >= audio[index - 1].at + audio[index - 1].duration));
});

test('a large mixed group batch matches sequential cuts and restores byte for byte', () => {
  const edit = JSON.parse(doc([video('cam-0', 0, 3600, 0, 120)], [voice('mic-0', 0, 3600, .5, 120.5)]));
  edit.sources.push({ id: 'music', path: 'music.wav' });
  edit.tracks.push({ id: 'bgm', lane: 'audio', items: [{ id: 'music-0', role: 'bgm', at: 0, duration: 3600,
    source: { kind: 'media', src: 'music', in: 0, out: 120 } }] });
  edit.tracks.push({ id: 'captions', lane: 'visual', content: { from: 'captions.json' } });
  const initial = source(edit);
  const ranges = Array.from({ length: 40 }, (_, index) => {
    const start = 1 + index * 2 + (index % 2 ? .5 : 0);
    return { ...cut(start, start + .2, index % 2 ? 'mic' : 'cam', 'filler'),
      reason: 'word', label: 'えー' };
  }).reverse();
  const batch = applyCutRanges(initial, ranges);
  let sequential = initial;
  for (const range of ranges) sequential = applyCutRanges(sequential, [range]).source;
  assert.equal(batch.source, sequential);
  assert.deepEqual(batch.warnings, []);
  let restored = batch.source;
  for (const range of [...ranges].reverse()) {
    const result = restoreCutRange(restored, range);
    assert.equal(result.restored, true);
    restored = result.source;
  }
  assert.equal(restored, initial);
});

test('group warnings distinguish a refused range from a partially covered range', () => {
  const initial = doc([video('cam-0', 0, 150, 0, 5)], [voice('mic-0', 0, 180, 0, 6)]);
  const refused = applyCutRanges(initial, [cut(1, 1.2), cut(5.2, 5.8)]);
  assert.deepEqual(refused.warnings, ['同期した映像がこの区間にないため、カットしませんでした。']);
  const partial = applyCutRanges(initial, [cut(4.5, 5.5)]);
  assert.deepEqual(partial.warnings, ['映像のある部分だけ切りました。']);
});

test('multiple cuts without a group do not report partial video coverage', () => {
  const edit = JSON.parse(doc([video('cam-0', 0, 180, 0, 6)], []));
  delete edit.sync_groups;
  const result = applyCutRanges(source(edit), [cut(1, 1.2, 'cam'), cut(2, 2.2, 'cam')]);
  assert.ok(!result.warnings.includes('映像のある部分だけ切りました。'));
});
