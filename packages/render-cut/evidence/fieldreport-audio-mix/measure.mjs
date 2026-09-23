import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAudioMixCommand } from '../../src/plan.mjs';
import { commandVersion } from '../../src/render-cut.mjs';
import { buildAudioQc, parseAudioToolVersion } from '../../src/audio-qc.mjs';
import { countAudioItems, filterGraphFileOption, prepareAudioMixExecution } from '../../src/audio-command.mjs';
import { toV2Edit } from '../../test/helpers/v2-fixture.mjs';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('usage: node measure.mjs before|after');
const root = mkdtempSync(join(tmpdir(), 'audio-mix-fixture-'));
const evidence = dirname(fileURLToPath(import.meta.url));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const ffprobe = process.env.FFPROBE || 'ffprobe';
const tone = join(root, 'tone.wav');
const silence = join(root, 'silence.wav');
const video = join(root, 'video.mp4');
try {
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.15','-ar','48000','-ac','2','-y',tone]);
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.15','-y',silence]);
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','color=c=black:s=32x32:r=10:d=4','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','4','-c:v','mpeg4','-c:a','aac','-y',video]);
  const probeGraph = join(root,'probe.graph'); writeFileSync(probeGraph,'[0:a]anull[out]');
  const probeOption = option => spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','0.01',option,probeGraph,'-map','[out]','-f','null','-'],{encoding:'utf8'}).status === 0;
  const result = { phase, ffmpeg_version: commandVersion(ffmpeg, ['-version']), option_probe: {
    slash_filter_complex: probeOption('-/filter_complex'),
    filter_complex_script: probeOption('-filter_complex_script'),
  }, cases: {} };
  if (phase === 'after') result.version_cases = [
    'ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright (c) ...',
    'ffmpeg version 9.0-full_build-www.gyan.dev Copyright ...',
    'ffmpeg version 2026-09-01-git-abcdef1234-full_build-www.gyan.dev Copyright ...',
    'ffmpeg version N-12345-gabcdef Copyright ...',
    'ffmpeg version 7.1.1-tessus Copyright ...',
    'ffmpeg version 7.1 Copyright ...',
    'ffmpeg version 6.1.1 Copyright ...',
    null,
  ].map(line=>({line,parsed:parseAudioToolVersion(line),filter_graph_option:filterGraphFileOption(line)}));
  for (const mode of ['shared','distinct']) {
    const media = [];
    for (let i=0;i<136;i++) {
      const path = mode === 'shared' ? tone : join(root, `tone-${i}.wav`);
      if (mode === 'distinct') writeFileSync(path, readFileSync(tone));
      media.push(path);
    }
    const edit = { output:{fps:10}, audio:{
      narration: Array.from({length:15},(_,i)=>({id:`n${i}`,path:media[i],t:2+i*0.1})),
      bgm:{id:'bed',path:media[15],t:0,ducking:true,duck_db:-12,duck_attack:0.3,duck_release:0.3},
      sfx:Array.from({length:120},(_,i)=>({id:`s${i}`,path:media[16+i],t:i*0.025})),
      duck_keys:['narration'], master:{loudnorm:-14,true_peak_dbtp:-1.5},
    }};
    writeFileSync(join(root,`edit-${mode}.json`), JSON.stringify(edit));
    const workDirectory=join(root,`work-${mode}`); mkdirSync(workDirectory,{recursive:true});
    const command=buildAudioMixCommand({edit,projectRoot:root,inputPath:video,outputPath:join(root,`out-${mode}.mp4`),duration:4,ffmpegCommand:ffmpeg,ffprobeCommand:ffprobe,workDirectory});
    const args=command.args;
    const execution = phase === 'after' ? prepareAudioMixExecution(command,{ffmpegVersion:result.ffmpeg_version,graphPath:join(workDirectory,'audio-filter.txt'),projectRoot:root,audioItemCount:countAudioItems(edit.audio)}) : null;
    const length=execution?.commandLength ?? [command.command,...args].reduce((n,v)=>n+v.length+3,0);
    const envelope=readFileSync(join(workDirectory,'env-bgm.f32'));
    const gainAt=t=>{const p=Math.round(t*48000)*4;return Math.round(20*Math.log10(envelope.readFloatLE(p))*100)/100};
    const qc=buildAudioQc({master:edit.audio.master,filterStderr:'{"output_i":"-14.1","output_tp":"-2.2"}',outputPath:'fixture.mp4',ffmpegCommand:ffmpeg,toolVersion:commandVersion(ffmpeg,['-version']),spawnSyncImpl:()=>({status:0,stderr:'{"input_i":"-14.3","input_tp":"-2.2"}'})});
    result.cases[mode]={audio_items:136,command_utf16_upper_bound:length,input_count:args.filter(x=>x==='-i').length,filter_graph_chars:execution?.filterGraph?.length ?? args[args.indexOf('-filter_complex')+1]?.length ?? 0,bgm_gain_db:{'1.7':gainAt(1.7),'1.85':gainAt(1.85),'2.0':gainAt(2)},qc:{tool_version:qc.tool_version,verdict:qc.verdict},graph_delivery:execution?'file':'command'};
    if (phase === 'after' && mode === 'shared') {
      const graphPath=join(workDirectory,'audio-filter.txt');
      writeFileSync(graphPath,execution.filterGraph);
      const mixed=spawnSync(command.command,execution.args,{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:1024*1024});
      const mixedProbe=mixed.status===0?spawnSync(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',join(root,'out-shared.mp4')],{encoding:'utf8'}):null;
      let mixedInfo=null;try{mixedInfo=JSON.parse(mixedProbe?.stdout??'');}catch{}
      result.audio_phase_136={exit_status:mixed.status,error_code:mixed.error?.code??null,duration_seconds:Number(mixedInfo?.format?.duration??0),audio_streams:mixedInfo?.streams?.filter(stream=>stream.codec_type==='audio').length??0,
        stderr_tail:(mixed.stderr??'').split(/\r?\n/u).filter(Boolean).slice(-3).map(line=>line.replaceAll(root,'<fixture>').replace(/\/(?:Users|var|tmp|private|opt)\/\S+/gu,'<path>'))};
      const renderEdit = {version:0,output:{width:32,height:32,fps:10},source:{path:'video.mp4',proxy:null},cuts:[{in:0,out:4}],overlays:[],audio:{...edit.audio,
        narration:edit.audio.narration.map(item=>({...item,path:item.path.slice(root.length+1),provenance:{provider:'human'}})),
        bgm:{...Object.fromEntries(Object.entries(edit.audio.bgm).filter(([key])=>key!=='t')),path:edit.audio.bgm.path.slice(root.length+1)},
        sfx:edit.audio.sfx.map(item=>({...item,path:item.path.slice(root.length+1)})),
      }};
      writeFileSync(join(root,'edit.json'),JSON.stringify(toV2Edit(renderEdit)));
      mkdirSync(join(root,'.akari'),{recursive:true});
      writeFileSync(join(root,'.akari','lint.json'),'\{"version":1,"verdict":"pass"\}\n');
      if (!process.env.SKIP_FULL_RENDER) {
      const started=Date.now();
      const rendered=spawnSync(process.execPath,[join(evidence,'..','..','bin','render-cut.mjs'),root,'--engine',process.env.RENDER_ENGINE??'osr','--force','--no-verify-blank'],{encoding:'utf8',env:{...process.env,AKARI_OSR_SOFT:'1'},timeout:600000,maxBuffer:1024*1024});
      let renderState=null;
      try { renderState=JSON.parse(readFileSync(join(root,'.akari','render.json'),'utf8')); } catch {}
      const measured=renderState?.artifacts?.[0]?.ffprobe;
      result.render_136={exit_status:rendered.status,elapsed_seconds:Math.round((Date.now()-started)/1000),error_code:rendered.error?.code??null,
        verification:renderState?.verify?.verdict??null,
        artifact:measured?{duration_seconds:Number(measured.format?.duration??measured.duration??0),video_streams:measured.streams?.filter(stream=>stream.codec_type==='video').length??null,audio_streams:measured.streams?.filter(stream=>stream.codec_type==='audio').length??null}:null,
        stderr_tail:(rendered.stderr??'').split(/\r?\n/u).filter(Boolean).slice(-4).map(line=>line.replaceAll(root,'<fixture>').replace(/\/(?:Users|var|tmp|private|opt)\/\S+/gu,'<path>'))};
      }
    }
  }
  writeFileSync(join(evidence,`${phase}.json`),JSON.stringify(result,null,2)+'\n');
  writeFileSync(join(evidence,`${phase}.md`),`# ${phase.toUpperCase()}\n\nNeutral 136 item fixture (15 narration, 1 bed, 120 effects). Command length uses a conservative quoted UTF-16 upper bound.\n\n${Object.entries(result.cases).map(([k,v])=>`- ${k}: ${v.command_utf16_upper_bound} characters, ${v.input_count} inputs; BGM at narration start ${v.bgm_gain_db['2.0']} dB; QC ${v.qc.verdict}; tool ${v.qc.tool_version}`).join('\n')}\n\nffmpeg options: -/filter_complex=${result.option_probe.slash_filter_complex}, -filter_complex_script=${result.option_probe.filter_complex_script}.\n${phase==='after'?'The BEFORE option_probe values reflect a later direct remeasurement with the same installed binary.\n':''}${result.version_cases?`\nVersion cases:\n${result.version_cases.map(value=>`- ${value.line??'(null)'} → ${value.parsed??'(null)'}; ${value.filter_graph_option??'inline graph'}`).join('\n')}\n`:''}${result.audio_phase_136?`\nAudio phase: exit ${result.audio_phase_136.exit_status}, ${result.audio_phase_136.duration_seconds}s output, ${result.audio_phase_136.audio_streams} audio stream(s).\n`:''}${result.render_136?`\nrender-cut: exit ${result.render_136.exit_status}, verification ${result.render_136.verification}, elapsed ${result.render_136.elapsed_seconds}s.\n`:''}`);
  process.stdout.write(JSON.stringify(result)+'\n');
} finally { rmSync(root,{recursive:true,force:true}); }
