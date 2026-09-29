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

test('multiple BGM warns only for overlap without either fade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-bgm-message-'));
  try {
    const edit = JSON.parse(await readFile(new URL('../fixtures/v2-audio-bgm-multiple-invalid/edit.json', import.meta.url)));
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const adjacent = await lintProject(root);
    const adjacentMessage = adjacent.findings.find(f => f.check === 'v2.audio-bgm-multiple')?.message ?? '';
    assert.equal(adjacentMessage, '');
    assert.equal(adjacent.verdict, 'pass');
    edit.tracks[1].items[0].at = 40;
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const spaced = await lintProject(root);
    assert.equal(spaced.verdict, 'pass');
    assert.equal(spaced.findings.some(f => f.check === 'v2.audio-bgm-multiple'), false);
    edit.tracks[1].items[0].at = 20;
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const overlapping = await lintProject(root);
    const bgmFindings = result => result.findings.filter(f => f.check === 'v2.audio-bgm-multiple');
    assert.equal(overlapping.verdict, 'pass');
    assert.equal(bgmFindings(overlapping).length, 1);
    assert.equal(bgmFindings(overlapping)[0].severity, 'warning');
    assert.match(bgmFindings(overlapping)[0].message, /重なり: music-1 \/ music-2 \[20, 30\)/);
    assert.match(bgmFindings(overlapping)[0].message, /fade_out/);
    assert.match(bgmFindings(overlapping)[0].message, /fade_in/);
    assert.match(bgmFindings(overlapping)[0].message, /"fade_out": 0\.33/u);
    for (const [firstFade, secondFade] of [[0.33, undefined], [undefined, 0.33], [0.33, 0.33]]) {
      if (firstFade === undefined) delete edit.tracks[0].items[0].fade_out;
      else edit.tracks[0].items[0].fade_out = firstFade;
      if (secondFade === undefined) delete edit.tracks[1].items[0].fade_in;
      else edit.tracks[1].items[0].fade_in = secondFade;
      await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
      const result = await lintProject(root);
      assert.equal(result.verdict, 'pass');
      assert.equal(bgmFindings(result).length, 0);
    }
    edit.tracks[0].items[0].fade_out = 0.33;
    delete edit.tracks[1].items[0].fade_in;
    edit.tracks.push({ id: 'bgm-3', lane: 'audio', items: [{
      id: 'music-3', at: 40, duration: 30, role: 'bgm',
      source: { kind: 'media', src: 'music', in: 0, out: 1 },
    }] });
    edit.tracks[1].items[0].duration = 30;
    edit.tracks[1].items[0].at = 20;
    edit.tracks[2].items[0].at = 40;
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const three = await lintProject(root);
    assert.equal(three.verdict, 'pass');
    assert.equal(bgmFindings(three).length, 1);
    assert.match(bgmFindings(three)[0].message, /重なり: music-2 \/ music-3 \[40, 50\)/);
    assert.doesNotMatch(bgmFindings(three)[0].message, /重なり: music-1 \/ music-2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
