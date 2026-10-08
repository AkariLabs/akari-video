import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAudioMixCommand } from '../src/plan.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const audiblePath = 'templates/kaisetsu-short/sample-project/narration/s1-hook.wav';
const skippedPath = 'templates/kaisetsu-short/sample-project/narration/s2-diagram.wav';
const materialPath = value => path.resolve(projectRoot, value);

function durationOf(value) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
    materialPath(value),
  ], { encoding: 'utf8' });
  return result.error || result.status !== 0 ? null : Number(result.stdout);
}

function plan(sfx, codec = 'h264') {
  return buildAudioMixCommand({
    edit: { output: { fps: 30 }, audio: { sfx } }, projectRoot,
    inputPath: path.join(projectRoot, 'source.mp4'),
    outputPath: path.join(projectRoot, 'output.mp4'),
    duration: 10, codec, ffprobeCommand: 'ffprobe', ffmpegCommand: 'ffmpeg',
  });
}

test('skipped effects do not count as audible while mixed effects keep original indexes', t => {
  const audibleDuration = durationOf(audiblePath);
  const skippedDuration = durationOf(skippedPath);
  if (!Number.isFinite(audibleDuration) || !Number.isFinite(skippedDuration)) {
    return t.skip('ffprobe or fixture media unavailable');
  }
  const skipped = { path: skippedPath, t: 0, in: skippedDuration };
  const audible = { path: audiblePath, t: 0, in: 1 };

  const onlySkipped = plan([skipped]);
  assert.equal(onlySkipped.operation, 'copy');
  assert.equal(onlySkipped.hasAudibleAudio, false);
  assert.equal(onlySkipped.args?.includes(materialPath(skippedPath)) ?? false, false);
  assert.match(onlySkipped.warnings[0], /audio\.sfx\[0\].*skipped \(silent\)/u);

  const prores = plan([skipped], 'prores422');
  assert.equal(prores.operation, 'ffmpeg');
  assert.equal(prores.hasAudibleAudio, false);
  assert.equal(prores.args.includes(materialPath(skippedPath)), false);

  const onlyAudible = plan([audible]);
  assert.equal(onlyAudible.operation, 'ffmpeg');
  assert.equal(onlyAudible.hasAudibleAudio, true);
  assert.ok(onlyAudible.args.includes(materialPath(audiblePath)));

  const mixed = plan([skipped, audible]);
  assert.equal(mixed.hasAudibleAudio, true);
  assert.ok(mixed.args.includes(materialPath(audiblePath)));
  assert.equal(mixed.args.includes(materialPath(skippedPath)), false);
  assert.match(mixed.args[mixed.args.indexOf('-filter_complex') + 1], /\[sfx1\]/u);
  assert.deepEqual(mixed.warnings, onlySkipped.warnings);
});
