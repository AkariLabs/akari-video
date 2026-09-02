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
    tracks: [{ id: 'visual-main', lane: 'visual', items: [{
      id: 'cut-1', at: 0, duration: 150,
      source: { kind: 'media', src: 'main', in: 0, out: 5 },
    }] }],
    audio: {},
  };
}

function addAudioItem(edit, role, item) {
  edit.tracks.push({ id: `audio-${role}`, lane: 'audio', items: [{
    id: role === 'narration' ? 'n-0001' : role,
    at: 0,
    duration: 150,
    role,
    source: { kind: 'media', src: role === 'narration' ? 'voice' : 'music', in: 0 },
    ...item,
  }] });
}

async function lint(edit) {
  const root = await mkdtemp(join(tmpdir(), 'akari-audio-envelope-lint-'));
  try {
    await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`, 'utf8');
    return await lintProject(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('audio keyframe の同時刻は audio.keyframes.t-order error', async () => {
  const edit = baseEdit();
  addAudioItem(edit, 'bgm', {
    keyframes: [{ t: 1, gain_db: 0 }, { t: 1, gain_db: -6 }],
  });
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error'
    && finding.check === 'audio.keyframes.t-order'));
});

test('audio keyframe が実効尺を超えると warning', async () => {
  const edit = baseEdit();
  addAudioItem(edit, 'bgm', {
    keyframes: [{ t: 0, gain_db: 0 }, { t: 180, gain_db: -6 }],
  });
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'warning'
    && finding.check === 'audio.keyframes.duration'));
});

test('ducking: true の narration は対象外 warning', async () => {
  const edit = baseEdit();
  addAudioItem(edit, 'narration', { gain_db: 0, ducking: true });
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'warning'
    && finding.check === 'audio.narration.ducking-target'));
});

test('duck_keys の未知語彙は error', async () => {
  const edit = baseEdit();
  edit.audio.duck_keys = ['dialogue'];
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'error'
    && finding.check === 'audio.duck-keys'));
});

test('v2 audio keyframe の visual key は ignored-key warning', async () => {
  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'music', path: 'music.wav' }],
    tracks: [{ id: 'audio-bgm', lane: 'audio', items: [{
      id: 'bgm', at: 0, duration: 150, role: 'bgm',
      source: { kind: 'media', src: 'music', in: 0 },
      keyframes: [
        { t: 0, gain_db: 0, opacity: 1 },
        { t: 30, gain_db: -6, transform: { scale: 2 } },
      ],
    }] }],
  };
  const result = await lint(edit);
  assert.ok(result.findings.some(finding => finding.severity === 'warning'
    && finding.check === 'v2.audio-keyframe-ignored-key'));
});
