import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lintProject, runCli } from '../src/edit-lint.mjs';

test('alternate edit resolves project root from nearest .akari ancestor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-root-'));
  try {
    await mkdir(join(root, '.akari'));
    await mkdir(join(root, 'review'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'music.wav'), 'fixture');
    const edit = JSON.parse(await readFile(new URL('../fixtures/v2-audio-bgm-multiple-invalid/edit.json', import.meta.url)));
    edit.tracks = edit.tracks.slice(0, 1);
    await writeFile(join(root, 'review', 'edit.json'), JSON.stringify(edit));
    await lintProject(join(root, 'review', 'edit.json'));
    await access(join(root, '.akari', 'lint.json'));
    await assert.rejects(access(join(root, 'review', '.akari', 'lint.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('narration without provenance keeps the existing PASS behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-provider-'));
  try {
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'voice', path: 'voice.wav' }],
      tracks: [{ id: 'audio', lane: 'audio', items: [{
        id: 'narration', at: 0, duration: 30, role: 'narration',
        source: { kind: 'media', src: 'voice', in: 0, out: 1 },
      }] }],
    };
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const result = await lintProject(root);
    assert.equal(result.verdict, 'pass');
    assert.equal(result.findings.some(f => f.check === 'v2.audio-narration-provider'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('present narration provenance without provider retains execution error with guidance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-provider-required-'));
  try {
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'voice', path: 'voice.wav' }],
      tracks: [{ id: 'audio', lane: 'audio', items: [{
        id: 'narration', at: 0, duration: 30, role: 'narration',
        source: { kind: 'media', src: 'voice', in: 0, out: 1 },
        provenance: { voice: 'speaker' },
      }] }],
    };
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    await assert.rejects(lintProject(root), error => {
      assert.match(error.message, /provenance\.provider は必須です/);
      assert.match(error.message, /\{"provider":"voicevox","credit":"VOICEVOX:ずんだもん"\}/);
      return true;
    });
    const errors = [];
    assert.equal(await runCli([root, '--json'], { log() {}, error: line => errors.push(line) }), 2);
    assert.match(errors.join('\n'), /provenance\.provider は必須です/);
    edit.tracks[0].items[0].provenance.provider = '';
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    await assert.rejects(lintProject(root), /provenance\.provider は必須です/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('multiple BGM error names clips, frame ranges, overlap, and the safe edit path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-bgm-message-'));
  try {
    const edit = JSON.parse(await readFile(new URL('../fixtures/v2-audio-bgm-multiple-invalid/edit.json', import.meta.url)));
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const adjacent = await lintProject(root);
    const adjacentMessage = adjacent.findings.find(f => f.check === 'v2.audio-bgm-multiple')?.message ?? '';
    assert.match(adjacentMessage, /music-1 \[0, 30\)/);
    assert.match(adjacentMessage, /music-2 \[30, 60\)/);
    assert.match(adjacentMessage, /重なり: なし/);
    assert.match(adjacentMessage, /音源側で 1 ファイルに編集/);
    edit.tracks[1].items[0].at = 20;
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const overlapping = await lintProject(root);
    assert.match(overlapping.findings.find(f => f.check === 'v2.audio-bgm-multiple')?.message ?? '', /重なり: music-1 \/ music-2 \[20, 30\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
