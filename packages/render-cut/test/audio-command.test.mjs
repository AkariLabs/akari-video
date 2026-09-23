import assert from 'node:assert/strict';
import test from 'node:test';
import { countAudioItems, filterGraphFileOption, parseFfmpegMajorVersion, prepareAudioMixExecution } from '../src/audio-command.mjs';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAudioMixCommand, isShareableSfxProbe } from '../src/plan.mjs';
import { buildAudioQc, parseAudioToolVersion, probeToolVersion } from '../src/audio-qc.mjs';
import editStore from '../../edit-store/lib/index.js';
import { executeAudioPlan, RefusalError } from '../src/render-cut.mjs';

test('ffmpeg release lines select the supported graph-file option', () => {
  for (const [line, major, option] of [
    ['ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright', 8, '-/filter_complex'],
    ['ffmpeg version 9.0-full_build-www.gyan.dev Copyright', 9, '-/filter_complex'],
    ['ffmpeg version 7.1 Copyright', 7, '-/filter_complex'],
    ['ffmpeg version 6.1.1 Copyright', 6, '-filter_complex_script'],
    ['ffmpeg version N-12345-gabcdef Copyright', null, '-/filter_complex'],
    ['ffmpeg version 2026-09-01-git-abcdef1234-full_build-www.gyan.dev Copyright', null, '-/filter_complex'],
  ]) {
    assert.equal(parseFfmpegMajorVersion(line), major);
    assert.equal(filterGraphFileOption(line), option);
  }
  assert.equal(filterGraphFileOption(null), null);
  assert.equal(filterGraphFileOption('not ffmpeg'), null);
});

test('audio tool version parser accepts release lines and rejects errors', () => {
  for (const line of [
    'ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright (c) ...',
    'ffmpeg version 9.0-full_build-www.gyan.dev Copyright ...',
    'ffmpeg version 2026-09-01-git-abcdef1234-full_build-www.gyan.dev Copyright ...',
    'ffmpeg version N-12345-gabcdef Copyright ...',
    'ffmpeg version 7.1.1-tessus Copyright ...',
    'ffmpeg version 9.0 Copyright',
  ]) assert.equal(parseAudioToolVersion(`${line}\nconfiguration: fixture`), line);
  assert.equal(parseAudioToolVersion('ffprobe version 8.1.1 Copyright'), 'ffprobe version 8.1.1 Copyright');
  assert.equal(parseAudioToolVersion('unrecognized option'), null);
  assert.equal(parseAudioToolVersion('ffmpeg version '), null);
  assert.equal(parseAudioToolVersion('other version 9.0'), null);
});

test('version probe explains process, exit and parse failures', () => {
  const probe=result=>probeToolVersion('ffmpeg',['-version'],()=>result);
  assert.deepEqual(probe({status:0,stdout:'ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright\n'}),{
    version:'ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright',error:null,
  });
  assert.match(probe({error:Object.assign(new Error('spawn ffmpeg ENOENT'),{code:'ENOENT'})}).error,/ENOENT/u);
  assert.match(probe({status:2,stderr:'failed'}).error,/status 2/u);
  assert.match(probe({status:0,stdout:'invalid output'}).error,/invalid output/u);
});

test('missing tool version preserves measured QC and reports probe reason', () => {
  const options={master:{loudnorm:-14},filterStderr:'{"output_i":"-14.1","output_tp":"-2.0"}',outputPath:'fixture.wav',ffmpegCommand:'ffmpeg',
    spawnSyncImpl:()=>({status:0,stderr:'{"input_i":"-14.3","input_tp":"-2.2"}'})};
  const missing=buildAudioQc({...options,toolVersion:null,toolVersionError:'spawn ffmpeg ENOENT'});
  assert.equal(missing.verdict,'INCONCLUSIVE');
  assert.equal(missing.decoded_measurement.normalized.input_i,-14.3);
  assert.equal(missing.tool_version_error,'spawn ffmpeg ENOENT');
  const present=buildAudioQc({...options,toolVersion:'ffmpeg version 9.0'});
  assert.equal(Object.hasOwn(present,'tool_version_error'),false);
});

test('duck envelope reaches the target at narration onset', () => {
  const points=editStore.computeDuckEnvelope([{startSec:2,endSec:2.5}],{duckDb:-12,attackSec:0.3,releaseSec:0.3,clipStartSec:0,clipDurationSec:4});
  assert.equal(editStore.evaluateEnvelopeDb(points,1.7),0);
  assert.ok(Math.abs(editStore.evaluateEnvelopeDb(points,1.85)+6)<1e-9);
  assert.equal(editStore.evaluateEnvelopeDb(points,2),-12);
});

test('audio graph moves out of the process command and stays under a Windows limit', () => {
  const plan = { command:'ffmpeg', args:['-i','bed.wav','-filter_complex','[0:a]anull[out]','-map','[out]','output.mp4'] };
  const execution = prepareAudioMixExecution(plan,{ffmpegVersion:'ffmpeg version 8.1.1',graphPath:'graph.txt'});
  assert.equal(execution.filterGraph,'[0:a]anull[out]');
  assert.ok(execution.args.includes('-/filter_complex'));
  assert.ok(execution.commandLength < 8000);
});

test('unknown ffmpeg version keeps the inline graph and still checks length', () => {
  const plan={command:'ffmpeg',args:['-i','in.wav','-filter_complex','anull','out.wav']};
  const execution=prepareAudioMixExecution(plan,{ffmpegVersion:null,limit:1000});
  assert.equal(execution.filterGraph,null);
  assert.deepEqual(execution.args,plan.args);
  assert.throws(()=>prepareAudioMixExecution(plan,{ffmpegVersion:null,limit:10}),/上限 10 文字/u);
});

test('relative media paths are used only when shorter and protected from leading dash', () => {
  const root=join(tmpdir(),'project');
  const outside='/a.wav';
  const inside=join(root,'-tone.wav');
  const plan={command:'ffmpeg',args:['-i',inside,'-i',outside,'-filter_complex','anull',join(root,'out.wav')]};
  const execution=prepareAudioMixExecution(plan,{ffmpegVersion:'ffmpeg version 7.1',graphPath:join(root,'graph.txt'),projectRoot:root});
  assert.equal(execution.args[1],'./-tone.wav');
  assert.equal(execution.args[3],outside);
  assert.equal(execution.args.at(-1),'out.wav');
});

test('oversize audio command explains item count, size, limit and stem workaround', () => {
  const plan = { command:'ffmpeg', args:['-i','long-input.wav','-filter_complex','anull','out.mp4'] };
  assert.throws(()=>prepareAudioMixExecution(plan,{ffmpegVersion:'ffmpeg version 8.1.1',graphPath:'graph.txt',audioItemCount:136,limit:20}),/音声アイテム 136 個.*上限 20 文字.*ステム/u);
});

test('oversize audio command is refused before launch even without a master', async () => {
  const plan={operation:'ffmpeg',command:'ffmpeg',output:join(tmpdir(),'out.wav'),args:['-filter_complex','a'.repeat(132000),'out.wav']};
  await assert.rejects(executeAudioPlan(plan,null,{projectRoot:tmpdir(),temporaryDirectory:tmpdir(),audioItemCount:136}),error=>error instanceof RefusalError && /音声アイテム 136 個.*ステム/u.test(error.message));
});

test('only probed SFX up to 30 seconds can share an input', () => {
  assert.equal(isShareableSfxProbe({hasAudio:true,duration:30}),true);
  assert.equal(isShareableSfxProbe({hasAudio:true,duration:30.01}),false);
  assert.equal(isShareableSfxProbe({hasAudio:false,duration:1}),false);
  assert.equal(countAudioItems({narration:[{},{}],speech:[{}],bgm:{},sfx:[{},{}]}),6);
});

test('136 repeated effects use one source input and an asplit without starting ffmpeg', () => {
  const root=mkdtempSync(join(tmpdir(),'audio-command-unit-'));
  try {
    const probe=join(root,'probe.sh');
    writeFileSync(probe,'#!/bin/sh\nprintf \'{"streams":[{"codec_type":"audio"}],"format":{"duration":"0.15"}}\'\n');
    chmodSync(probe,0o755);
    const edit={output:{fps:10},audio:{sfx:Array.from({length:136},(_,i)=>({id:`s${i}`,path:'tone.wav',t:i/100}))}};
    const plan=buildAudioMixCommand({edit,projectRoot:root,inputPath:join(root,'video.mp4'),outputPath:join(root,'out.mp4'),duration:4,ffmpegCommand:'ffmpeg',ffprobeCommand:probe,workDirectory:root});
    assert.equal(plan.args.filter(arg=>arg==='-i').length,2);
    assert.match(plan.args[plan.args.indexOf('-filter_complex')+1],/asplit=136/u);
    const execution=prepareAudioMixExecution(plan,{ffmpegVersion:'ffmpeg version 8.1.1',graphPath:join(root,'graph.txt'),projectRoot:root,audioItemCount:countAudioItems(edit.audio)});
    assert.ok(execution.commandLength<8000);
    writeFileSync(probe,'#!/bin/sh\nprintf \'{"streams":[{"codec_type":"audio"}],"format":{"duration":"31"}}\'\n');
    const long=buildAudioMixCommand({edit,projectRoot:root,inputPath:join(root,'video.mp4'),outputPath:join(root,'long.mp4'),duration:4,ffmpegCommand:'ffmpeg',ffprobeCommand:probe,workDirectory:root});
    assert.equal(long.args.filter(arg=>arg==='-i').length,137);
    assert.doesNotMatch(long.args[long.args.indexOf('-filter_complex')+1],/asplit=/u);
  } finally {rmSync(root,{recursive:true,force:true});}
});
