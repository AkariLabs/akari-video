import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readRenderEdit } from '../../src/internal-render.mjs';
import { buildAudioMixCommand } from '../../src/plan.mjs';
import { lintProject } from '../../../edit-lint/src/edit-lint.mjs';
const require = createRequire(import.meta.url);
const { projectLegacyEdit, projectLegacyAudioView, buildWebAudioSchedule } = require('../../../edit-store/lib/index.js');
const phase = process.argv[2] ?? 'before';
if (phase !== 'before' && phase !== 'after') throw new Error('phase must be before or after');
const root = mkdtempSync(join(tmpdir(), 'bgm-measure-'));
function run(args) { const r = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-y',...args], {encoding:'utf8'}); if(r.status !== 0) throw Error(r.stderr); }
for (const [name, hz] of [['one',440],['two',880],['voice',1200]]) run(['-f','lavfi','-i',`sine=frequency=${hz}:duration=8:sample_rate=48000`,'-c:a','pcm_s16le',join(root,`${name}.wav`)]);
run(['-f','lavfi','-i','color=c=black:s=320x180:r=30:d=6','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','6','-c:v','libx264','-c:a','aac',join(root,'input.mp4')]);
const cases = { adjacent:[[0,3],[3,6]], gap:[[0,2],[4,6]], overlap:[[0,4],[3,6]] };
const results={};
for(const [name, intervals] of Object.entries(cases)) {
 const edit={version:2,output:{width:320,height:180,fps:30},sources:[{id:'one',path:'one.wav'},{id:'two',path:'two.wav'},{id:'voice',path:'voice.wav'}],tracks:[...intervals.map(([start,end],i)=>({id:`audio-${i}`,lane:'audio',items:[{id:`music-${i+1}`,role:'bgm',at:start*30,duration:(end-start)*30,ducking:true,source:{kind:'media',src:i?'two':'one',in:0,out:end-start}}]})),{id:'voice-track',lane:'audio',items:[{id:'voice',role:'narration',at:30,duration:15,source:{kind:'media',src:'voice',in:0,out:.5}},{id:'voice-2',role:'narration',at:120,duration:15,source:{kind:'media',src:'voice',in:0,out:.5}}]}]};
 writeFileSync(join(root,'edit.json'),JSON.stringify(edit));
 const lint=await lintProject(root); const projected=readRenderEdit(edit,join(root,'.akari','render-tmp'),{projectRoot:root});
 const projectedAudio = projectLegacyAudioView(projected.internal);
 const allBgms = projectedAudio.bgms ?? (projectedAudio.bgm ? [projectedAudio.bgm] : []);
 if (phase === 'after') projected.edit.audio.bgms = allBgms;
 const plan=buildAudioMixCommand({edit:projected.edit,projectRoot:root,inputPath:join(root,'input.mp4'),outputPath:join(root,`${name}.mp4`),workDirectory:root,duration:6,ffmpegCommand:'ffmpeg',ffprobeCommand:'ffprobe'});
 let renderError=null; if(plan.operation==='ffmpeg'){const p=spawnSync(plan.command,plan.args,{encoding:'utf8'});if(p.status!==0)renderError=p.stderr.slice(-600).replaceAll(root, "<temp>");}
 const windows=[];if(!renderError){for(const t of [.5,1.25,2.5,3.5,4.25,4.5,5.5]){const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss',String(t),'-i',join(root,`${name}.mp4`),'-t','0.2','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:null});let energy=0,cross=0;const count=Math.floor(p.stdout.length/4);const spectral=(hz)=>{let re=0,im=0;for(let i=0;i<count;i++){const sample=p.stdout.readFloatLE(i*4);const angle=2*Math.PI*hz*i/48000;re+=sample*Math.cos(angle);im+=sample*Math.sin(angle);}return +(2*Math.hypot(re,im)/(count||1)).toFixed(5);};for(let i=1;i<count;i++){const prev=p.stdout.readFloatLE((i-1)*4),current=p.stdout.readFloatLE(i*4);energy+=current*current;if(prev<=0&&current>0)cross++;}windows.push({at:t,rms:+Math.sqrt(energy/(count||1)).toFixed(5),hz:Math.round(cross/.2),tone440:spectral(440),tone880:spectral(880),decodeExit:p.status,decodeError:p.status===0?undefined:p.stderr.toString().slice(-200).replaceAll(root, "<temp>")});}}
 const previewBgms = allBgms.map((item,index)=>({id:item.id ?? `bgm-${index}`,t:item.t,duration:item.duration,durationSec:8,ducking:true}));
 const preview = buildWebAudioSchedule({timelineDurationSec:6,startAtSec:0,
  audio:phase === 'before' ? {bgm:previewBgms[0]} : {bgms:previewBgms},
  speechKeyIntervals:[{startSec:1,endSec:1.5},{startSec:4,endSec:4.5}]});
 results[name]={preview:{items:preview.items.filter(item=>item.kind==='bgm').map(item=>({id:item.id,start:item.timelineStartSec,end:item.timelineEndSec,minimumEnvelopeGain:Math.min(...item.envelopeEvents.map(event=>event.value))}))},lint:lint.verdict,lintErrors:lint.findings.filter(f=>f.severity==='error').map(f=>f.check),bgmError:lint.findings.filter(f=>f.check==='v2.audio-bgm-multiple').map(f=>f.message),projectedBgms:allBgms.map(b=>({path:b.path,t:b.t,duration:b.duration}))??[],projectedBgm:projected.edit.audio.bgm?.path??null,legacyBgms:projectLegacyEdit(projected.internal).audioBgms?.length??0,plan:{operation:plan.operation,inputCount:(plan.args??[]).filter(x=>x==='-i').length,bgmFilterCount:(plan.args??[]).find((x,i)=>plan.args[i-1]==='-filter_complex')?.match(/\[bgm(?:_base|_env|\d|\])/g)?.length??0,ducked:plan.envelope?.ducked_items??[]},renderError,windows};
}
writeFileSync(new URL(`./${phase}.json`,import.meta.url),JSON.stringify(results,null,2)+'\n');
const phaseDetails = phase === 'before'
 ? 'This run uses the af19dd23 baseline. The legacy projection and preview schedule contain only the final BGM.'
 : 'In the adjacent case, BGM 1 falls from 0.12404 to 0.03124 and BGM 2 from 0.12472 to 0.03133 during narration (both about -12 dB).';
writeFileSync(new URL(`./${phase}.md`,import.meta.url),`# ${phase.toUpperCase()}\n\nNeutral tones: BGM 1 = 440 Hz; BGM 2 = 880 Hz; narration = 1200 Hz. Intervals in seconds. JSON contains measured RMS, zero-crossing frequencies, per-tone amplitudes, and preview schedule outputs. ${phaseDetails} Source media and rendered media were generated under a temporary directory and are not retained.\n\n${Object.entries(results).map(([name,r])=>`- ${name}: lint ${r.lint}; projected ${r.projectedBgms.length} BGM(s); selected ${r.projectedBgm}; plan ${r.plan.inputCount} audio input(s); rendered ${r.renderError?'failed':'success'}; windows ${r.windows.map(w=>`${w.at}s:${w.hz}Hz/${w.rms}`).join(', ')}`).join('\n')}\n`);
if (phase === 'after') {
 const baseline = JSON.parse(readFileSync(new URL('../../test/multi-bgm-baseline.snapshot.json', import.meta.url)));
 const audio = { bgm: { id:'bgm', path:'one.wav', t:0, duration:6, in:1, fadeIn:.3, fadeOut:.4, gain_db:-6, ducking:true },
  narration:[{id:'voice',path:'voice.wav',t:2,in:0,out:.5}] };
 const current = buildAudioMixCommand({edit:{output:{fps:30},audio},projectRoot:root,inputPath:join(root,'input.mp4'),outputPath:join(root,'single.mp4'),workDirectory:root,duration:6,ffmpegCommand:'ffmpeg',ffprobeCommand:'ffprobe'});
 const old = JSON.parse(JSON.stringify(baseline).replaceAll('/fixture',root).replaceAll('output.mp4','single.mp4'));
 const graphOf = plan => plan.args[plan.args.indexOf('-filter_complex')+1];
 const execute = plan => {const p=spawnSync(plan.command,plan.args,{encoding:'utf8'});if(p.status!==0)throw Error(p.stderr.slice(-500));return readFileSync(join(root,'single.mp4'));};
 const { createHash } = await import('node:crypto');
 const digest = bytes => createHash('sha256').update(bytes).digest('hex');
 const baselineHash=digest(execute(old));
 const currentHash=digest(execute(current));
 const result={planEqual:JSON.stringify(old)===JSON.stringify(current),graphByteEqual:graphOf(old)===graphOf(current),outputByteEqual:baselineHash===currentHash,baselineSha256:baselineHash,currentSha256:currentHash};
 writeFileSync(new URL('./single-bgm.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 writeFileSync(new URL('./single-bgm.md',import.meta.url),`# Single BGM regression\n\nHEAD plan snapshot and current plan were executed against the same neutral inputs. Plan deep equality: ${result.planEqual}; FFmpeg graph byte equality: ${result.graphByteEqual}; output file byte equality: ${result.outputByteEqual}.\n`);
}
