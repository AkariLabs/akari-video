import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { lintProject } from '../src/edit-lint.mjs';

function baseEdit() {
  return {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [
      { id: 'main', path: 'source.mp4', proxy: null },
      { id: 'music', path: 'music.wav', proxy: null },
      { id: 'voice', path: 'voice.wav', proxy: null },
    ],
    tracks: [
      { id: 'visual', lane: 'visual', items: [{
        id: 'cut', at: 0, duration: 150,
        source: { kind: 'media', src: 'main', in: 0, out: 5 },
      }] },
      { id: 'audio', lane: 'audio', items: [{
        id: 'bgm', at: 0, duration: 150, role: 'bgm',
        source: { kind: 'media', src: 'music', in: 0, out: 5 },
      }] },
    ],
    audio: {},
  };
}

const audioItem = edit => edit.tracks[1].items[0];

async function lint(edit) {
  const root = await mkdtemp(join(tmpdir(), 'akari-clip-fx-lint-'));
  try {
    await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`, 'utf8');
    return await lintProject(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('speed outside (0.25, 4] is an error', async () => {
  const edit = baseEdit(); audioItem(edit).source.speed = 0.25;
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error' && finding.check === 'audio.bgm.speed'));
});

test('pitch_semitones outside [-24, 24] is an error', async () => {
  const edit = baseEdit(); audioItem(edit).source.pitch_semitones = 24.1;
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error' && finding.check === 'audio.bgm.pitch-semitones'));
});

test('unknown denoise.method is an error', async () => {
  const edit = baseEdit(); audioItem(edit).denoise = { method: 'rnnoise', strength: 0.5 };
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error' && finding.check === 'audio.bgm.denoise-method'));
});

test('denoise.strength outside [0, 1] is an error', async () => {
  const edit = baseEdit(); audioItem(edit).denoise = { method: 'fft', strength: -0.01 };
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error' && finding.check === 'audio.bgm.denoise-strength'));
});

test('lowcut_hz outside [0, 400] is an error', async () => {
  const edit = baseEdit(); audioItem(edit).lowcut_hz = 401;
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error' && finding.check === 'audio.bgm.lowcut-hz'));
});

test('narration speed and pitch are warnings and ignored', async () => {
  const edit = baseEdit();
  Object.assign(audioItem(edit), { id: 'n-0001', role: 'narration', provenance: { provider: 'human' } });
  audioItem(edit).source = {
    kind: 'media', src: 'voice', in: 0, out: 5, speed: 2, pitch_semitones: 12,
  };
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'warning'
    && finding.check === 'audio.narration.speed-ignored'));
  assert.ok(result.findings.some(finding => finding.severity === 'warning'
    && finding.check === 'audio.narration.pitch-ignored'));
});

test('v2 validates source FX and item FX at their canonical locations', async () => {
  const edit = {
    version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'hit', path: 'hit.wav' }],
    tracks: [{ id: 'audio', lane: 'audio', items: [{
      id: 'hit-1', at: 0, duration: 30,
      source: { kind: 'media', src: 'hit', in: 0, out: 1, speed: 5 },
      denoise: { method: 'bad', strength: 0.5 }, lowcut_hz: -1,
    }] }],
  };
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.check === 'audio.sfx.speed'
    && finding.path.endsWith('.source.speed')));
  assert.ok(result.findings.some(finding => finding.check === 'audio.sfx.denoise-method'));
  assert.ok(result.findings.some(finding => finding.check === 'audio.sfx.lowcut-hz'));
});
