import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeLibraryLocation } from '../../creator-root/src/index.mjs';

test('beatmap reads the pinned library and fallback declarations by track id', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'beatmap-library-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp,'home'), root = path.join(temp,'creator/library'), project = path.join(temp,'project');
  const env = { ...process.env, AKARI_HOME: home, AKARI_CREATOR_ROOT: path.join(temp,'creator'), AKARI_LIBRARY_ROOT: '' };
  await writeLibraryLocation({ root, state: 'done' }, env);
  for (const location of [root, path.join(home,'assets')]) {
    await fs.mkdir(path.join(location,'audio/theme'), { recursive: true });
    await fs.writeFile(path.join(location,'audio/declarations.json'), JSON.stringify({ theme: { bpm:120, beat_offset_s:0, sections:[],hit_points:[] } }));
    const generated = spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=duration=1',path.join(location,'audio/theme/track.wav')],{encoding:'utf8'});
    assert.equal(generated.status,0,generated.stderr);
  }
  const cli = path.resolve(import.meta.dirname,'../bin/beatmap.mjs');
  await fs.mkdir(path.join(project,'assets/audio'), { recursive: true });
  await fs.writeFile(path.join(project,'assets/audio/declarations.json'), '{broken');
  for (const expected of [root, path.join(home,'assets')]) {
    const result = spawnSync(process.execPath,[cli,project,'theme'],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const output = JSON.parse(await fs.readFile(result.stdout.trim(),'utf8'));
    assert.equal(output.track_path,path.join(expected,'audio/theme/track.wav'));
    assert.equal(output.beats.length,2);
    await fs.writeFile(path.join(root,'audio/declarations.json'), '{also broken');
    await fs.rm(path.join(root,'audio/theme/track.wav'), {force:true});
  }
  await fs.writeFile(path.join(home,'assets/audio/declarations.json'), 'null');
  const missing = spawnSync(process.execPath,[cli,project,'theme'],{env,encoding:'utf8'});
  assert.equal(missing.status,1);
  assert.match(missing.stderr,/読み取れる declarations.json/);
  assert.doesNotMatch(missing.stderr,/SyntaxError|TypeError|at JSON.parse/);
});
