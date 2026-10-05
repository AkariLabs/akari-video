import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAudioMixCommand } from '../src/plan.mjs';

function graph(shape) {
  const root = mkdtempSync(join(tmpdir(), 'audio-fade-shape-'));
  try {
    const bgm = { path: 'music.wav', fadeIn: 1, fadeOut: 1 };
    if (shape) { bgm.fade_in_shape = shape; bgm.fade_out_shape = shape; }
    const command = buildAudioMixCommand({
      edit: { audio: { bgm } }, projectRoot: root,
      inputPath: join(root, 'composite.mp4'), outputPath: join(root, 'final.mp4'),
      workDirectory: root, duration: 4, ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe'
    });
    return command.args[command.args.indexOf('-filter_complex') + 1];
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('named shapes select afade curves without executing external tools', () => {
  const source = readFileSync(new URL('../src/plan.mjs', import.meta.url), 'utf8');
  assert.match(source, /audioFadeFfmpegCurve,[\s\S]*require\("\.\.\/\.\.\/edit-store\/lib\/index\.js"\)/);
  assert.match(source, /audioFadeFfmpegCurve\(shape\)/);
  assert.match(source, /projectAudioFadeShapes\(mixEdit\.audio \?\? \{\}, edit\.tracks\)/);
  assert.match(graph('slow'), /afade=t=in:st=0:d=1:curve=qua/);
  assert.match(graph('equal_power'), /afade=t=in:st=0:d=1:curve=qsin/);
  assert.match(graph('s_curve'), /afade=t=in:st=0:d=1:curve=hsin/);
});

test('omitted and explicit linear shape keep legacy filter bytes', () => {
  assert.equal(graph(undefined), graph('linear'));
  assert.match(graph(undefined), /afade=t=in:st=0:d=1,afade=t=out:st=3:d=1/);
  assert.doesNotMatch(graph(undefined), /curve=/);
});
