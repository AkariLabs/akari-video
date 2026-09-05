import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { needsGapAwareCutTimeline, resolveCutSegments } from "../src/cut-timeline.mjs";
import { cutSpeed, segmentDuration } from "../src/cut-timeline.mjs";
import { buildMultiSourceAudioCutCommand, buildGapAwareMultiSourceAudioCutCommand } from "../src/plan.mjs";
import { buildAtempoChain } from "../../media-bin/src/speech-atempo.mjs";

// 非 seek helper は現在 private / 呼び出し元なし。公開 API を増やさず実ソースを検査する。
const planSource = readFileSync(new URL('../src/plan.mjs', import.meta.url), 'utf8');
function planFunction(name) {
  const start = planSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return planSource.slice(start, planSource.indexOf('\n}\n', start) + 2);
}
const appendNonSeekAudio = new Function('cutSpeed', 'segmentDuration', 'buildAtempoChain', [
  planFunction('formatNumber'), planFunction('cutSpeechVolumeSuffix'),
  planFunction('appendAudioEndPaddingWarning'), planFunction('appendGapAwareAudioFilters'),
  'return appendGapAwareAudioFilters;'
].join('\n'))(cutSpeed, segmentDuration, buildAtempoChain);

function speechCommand(route, fields = {}, hasAudio = true) {
  const cut = { id: 'camera', src: 'main', in: 2, out: 10, speed: 2, ...fields };
  const sourceInputs = [{ id: 'main', path: 'camera.mp4', hasAudio, inputIndex: 0 }];
  const options = { sourceInputs, cuts: [cut], cutPath: 'cut-audio.mp4', duration: 6,
    ffmpegCommand: 'ffmpeg', ffprobeCommand: null };
  if (route === 'sequential') return buildMultiSourceAudioCutCommand(options);
  cut.at = 2;
  if (route === 'gap-seek') return buildGapAwareMultiSourceAudioCutCommand(options);
  const filters = [], warnings = [];
  appendNonSeekAudio({ filters, warnings, segments: resolveCutSegments([cut]),
    inputsById: new Map([['main', sourceInputs[0]]]), duration: 6, ffprobeCommand: null });
  return { args: ['-filter_complex', filters.join(';')], warnings };
}

function speechFilter(command) {
  return command.args[command.args.indexOf('-filter_complex') + 1];
}

for (const route of ['sequential', 'gap-seek', 'gap-nonseek']) {
  test(`${route}: muted embedded speech uses the existing silence branch and preserves input indexes`, () => {
    const muted = speechCommand(route, { mute: true });
    const filter = speechFilter(muted);
    assert.match(filter, /anullsrc=r=48000:cl=stereo,atrim=duration=4/);
    assert.doesNotMatch(filter, /\[0:a\]atrim|atempo=|volume=/);
    assert.equal(filter, speechFilter(speechCommand(route, {}, false)));
    assert.deepEqual(muted.warnings, []);
    if (route !== 'gap-nonseek') {
      const original = speechCommand(route);
      assert.deepEqual(muted.args.slice(0, muted.args.indexOf('-filter_complex')),
        original.args.slice(0, original.args.indexOf('-filter_complex')));
    }
  });

  test(`${route}: embedded speech gain follows atempo and precedes padding / delay / normalization`, () => {
    const filter = speechFilter(speechCommand(route, { gain_db: -12 }));
    assert.match(filter, /atempo=2,volume=-12dB/);
    const volume = filter.indexOf('volume=-12dB');
    assert.ok(volume > filter.indexOf('atempo=2'));
    for (const suffix of ['apad=', 'adelay=', 'aresample=', 'aformat=']) {
      if (filter.includes(suffix)) assert.ok(volume < filter.indexOf(suffix), suffix);
    }
  });

  test(`${route}: out-of-range embedded speech gain clamps with one warning`, () => {
    for (const [gain_db, expected] of [[20, 12], [-70, -60]]) {
      const command = speechCommand(route, { gain_db });
      assert.ok(speechFilter(command).includes(`volume=${expected}dB`));
      assert.deepEqual(command.warnings, [
        `cut camera: source.gain_db ${gain_db} is out of range; clamped to ${expected}`
      ]);
    }
  });

  test(`${route}: omitted, zero, and non-finite gain leave command bytes unchanged`, () => {
    const original = speechCommand(route);
    for (const gain_db of [undefined, 0, NaN, Infinity, -Infinity, 'bad']) {
      assert.deepEqual(speechCommand(route, { gain_db, mute: false }), original);
    }
    assert.doesNotMatch(speechFilter(original), /volume=/);
  });
}

test('sequential freeze speech applies gain to both trims and mute preserves the entire hold', () => {
  const freeze = { at_sec: 1, duration_sec: 2 };
  const filter = speechFilter(speechCommand('sequential', { freeze, gain_db: -12 }));
  assert.equal((filter.match(/atempo=2,volume=-12dB,aresample=/g) ?? []).length, 2);
  const muted = speechFilter(speechCommand('sequential', { freeze, mute: true }));
  assert.match(muted, /anullsrc=r=48000:cl=stereo,atrim=duration=6/);
  assert.doesNotMatch(muted, /\[0:a\]atrim|atempo=|fza_/);
});

test("multiple cuts without at or track keep the legacy timeline", () => {
  const cuts = [
    { in: 0, out: 5 },
    { in: 10, out: 15 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), false);
});

test("explicit track 0 and natural at positions keep the legacy timeline", () => {
  const cuts = [
    { at: 0, in: 0, out: 5, track: 0 },
    { at: 5, in: 10, out: 15, track: 0 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), false);
});

test("at can create a gap and resolved segment ends use output-axis duration", () => {
  const cuts = [
    { in: 0, out: 5 },
    { at: 8, in: 10, out: 15 },
  ];
  assert.equal(needsGapAwareCutTimeline(cuts), true);
  assert.deepEqual(
    resolveCutSegments(cuts).map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 5 },
      { start: 8, end: 13 },
    ],
  );
});

test("any cut on a higher track requires the gap-aware timeline", () => {
  assert.equal(needsGapAwareCutTimeline([{ in: 0, out: 5, track: 1 }]), true);
});

test("resolved segment ends account for cut speed", () => {
  const segments = resolveCutSegments([
    { in: 0, out: 6, speed: 2 },
    { in: 10, out: 14 },
  ]);
  assert.deepEqual(
    segments.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 3 },
      { start: 3, end: 7 },
    ],
  );
});
