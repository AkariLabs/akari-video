import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAudioMixCommand } from '../src/plan.mjs';
const baseline = JSON.parse(readFileSync(new URL('./multi-bgm-baseline.snapshot.json', import.meta.url)));
function planFor(audio) {
  const root = mkdtempSync(join(tmpdir(), 'multi-bgm-plan-'));
  writeFileSync(join(root, 'voice.wav'), 'fixture');
  const old = childProcess.spawnSync;
  childProcess.spawnSync = () => ({status: 0, stdout: JSON.stringify({streams:[{codec_type:'audio'}],format:{duration:'8'}})});
  syncBuiltinESMExports();
  try {
    const plan = buildAudioMixCommand({edit:{output:{fps:30},audio},projectRoot:root,
      inputPath:join(root,'input.mp4'),outputPath:join(root,'output.mp4'),workDirectory:root,
      duration:6,ffmpegCommand:'ffmpeg',ffprobeCommand:'ffprobe'});
    return JSON.parse(JSON.stringify(plan).replaceAll(root,'/fixture'));
  } finally { childProcess.spawnSync = old; syncBuiltinESMExports(); rmSync(root,{recursive:true,force:true}); }
}
const one = {id:'bgm',path:'one.wav',t:0,duration:6,in:1,fadeIn:.3,fadeOut:.4,gain_db:-6,ducking:true};
const voice = {id:'voice',path:'voice.wav',t:2,in:0,out:.5};
test('single BGM plan and ffmpeg graph equal HEAD baseline',()=>{
  const actual=planFor({bgm:one,narration:[voice]});
  assert.deepEqual(actual,baseline);
  assert.equal(actual.args[actual.args.indexOf('-filter_complex')+1],baseline.args[baseline.args.indexOf('-filter_complex')+1]);
});
test('two BGM inputs retain separate trim, delay, and duck envelopes',()=>{
  const plan=planFor({bgms:[{...one,id:'first',duration:3},{...one,id:'second',path:'two.wav',t:3,duration:3}],narration:[{...voice,t:2.75,out:1}]});
  const graph=plan.args[plan.args.indexOf('-filter_complex')+1];
  assert.match(graph,/\[bgm_env0\]/);
  assert.match(graph,/\[bgm_delayed1\]/);
  assert.deepEqual(plan.envelope.ducked_items,['first','second']);
  assert.equal(plan.envelopes.length,2);
});
