import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { writeLibraryLocation } from '../../creator-root/src/index.mjs';
import { audioReadPath, readAudioDeclarations } from '../shared/library-roots.mjs';
import { listTracks } from '../declare-server.mjs';

const bin = path.resolve(import.meta.dirname, '../bin');
test('offline sounds fetch, BGM suggestion and beat grid use the pinned location', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'audio-library-location-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'), root = path.join(temp, 'creator/library');
  const env = { ...process.env, AKARI_HOME: home, AKARI_CREATOR_ROOT: path.join(temp, 'creator'), AKARI_LIBRARY_ROOT: '' };
  await writeLibraryLocation({ root, state: 'done' }, env);
  const id = 'bgm-beatslide-124-001';
  const catalog = { library: 'fixture', version: 'v0', tracks: [{ id, title: 'Fixture', kind: 'bgm', tags: ['bgm','bpm-124'], files: [{ mp3: `${id}.mp3`, duration_sec: 1 }] }] };
  await fs.writeFile(path.join(temp, 'catalog.json'), JSON.stringify(catalog));
  const ffmpeg = spawnSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1',path.join(temp, `${id}.mp3`)], { encoding: 'utf8' });
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
  const zip = spawnSync('zip', ['-q', 'akari-sounds-mp3.zip', `${id}.mp3`], { cwd: temp, encoding: 'utf8' });
  assert.equal(zip.status, 0, zip.stderr);
  const run = (script, args) => {
    const result = spawnSync(process.execPath, [path.join(bin, script), ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout); return result.stdout;
  };
  run('fetch-akari-sounds.mjs', ['--catalog',path.join(temp,'catalog.json'),'--zips-dir',temp]);
  assert.ok(existsSync(path.join(root, 'audio/akari-sounds-bgm', `${id}.mp3`)));
  assert.equal(existsSync(path.join(home, 'assets')), false);
  const declaration = { bpm: 124, beat_offset_s: 0, sections: [], hit_points: [] };
  await fs.writeFile(path.join(root, 'audio/declarations.json'), JSON.stringify({ [id]: declaration }));
  const suggestions = JSON.parse(run('suggest-bgm.mjs', ['--tone','勢い','--json']));
  assert.equal(suggestions.suggestions[0].takes[0].exists, true);
  assert.equal(suggestions.suggestions[0].takes[0].path, path.join(root,'audio/akari-sounds-bgm',`${id}.mp3`));
  run('beat-grid.mjs', ['--track',id,'--timeline','1','--track-duration','1','--fps','30','--json']);
  // Restore process.env after exercising the default interactive-server read paths.
  const previous = { AKARI_HOME: process.env.AKARI_HOME, AKARI_LIBRARY_ROOT: process.env.AKARI_LIBRARY_ROOT };
  process.env.AKARI_HOME = home; delete process.env.AKARI_LIBRARY_ROOT;
  try {
    const oldAudio = path.join(home, 'assets/audio/late'); await fs.mkdir(oldAudio, { recursive: true });
    await fs.writeFile(path.join(oldAudio, 'track.wav'), 'late');
    await fs.writeFile(path.join(home, 'assets/audio/declarations.json'), JSON.stringify({ late: declaration, [id]: { bpm: 99 } }));
    assert.equal(audioReadPath(path.join(root,'audio'),'late','track.wav'), path.join(oldAudio,'track.wav'));
    assert.equal(readAudioDeclarations(path.join(root,'audio')).late.bpm, 124);
    assert.equal(readAudioDeclarations(path.join(root,'audio'))[id].bpm, 124);
    assert.ok((await listTracks(path.join(root,'audio'))).some(track => track.id === 'late'));
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('pending audio fetch stays in the legacy library without syncing new downloads', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'audio-library-pending-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'), root = path.join(temp, 'OneDrive/Akari/library');
  const env = { ...process.env, AKARI_HOME: home, AKARI_LIBRARY_ROOT: '', AKARI_CREATOR_ROOT: path.dirname(root) };
  await writeLibraryLocation({ root, state: 'pending' }, env);
  const catalog = path.join(temp, 'catalog.json');
  await fs.writeFile(catalog, JSON.stringify({ tracks: [] }));
  const result = spawnSync(process.execPath, [path.join(bin, 'fetch-akari-sounds.mjs'), '--catalog', catalog, '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`登録先: ${path.join(home, 'assets/audio')}`));
  assert.equal(existsSync(root), false);
});
