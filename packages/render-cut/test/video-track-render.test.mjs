import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlan } from '../src/plan.mjs';
function run(command,args) {const r=spawnSync(command,args,{maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;}
function pixel(path,time){return run('ffmpeg',['-v','error','-ss',String(time),'-i',path,'-vf','crop=2:2:30:20,format=rgb24','-frames:v','1','-f','rawvideo','pipe:1']);}
function energy(path,time){const bytes=run('ffmpeg',['-v','error','-ss',String(time),'-i',path,'-t','0.1','-vn','-ac','1','-ar','48000','-f','s16le','pipe:1']);if(!bytes.length)return 0;let sum=0;for(let i=0;i+1<bytes.length;i+=2)sum+=bytes.readInt16LE(i)**2;return Math.sqrt(sum/(bytes.length/2));}
test('real v1 shared-track export preserves shifted audio, duration, and header compositing order',{timeout:60000},t=>{
 if(spawnSync('ffmpeg',['-version']).status!==0){t.skip('ffmpeg unavailable');return;}
 const root=mkdtempSync(join(tmpdir(),'akari-video-tracks-'));
 try{
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=96x54:r=10:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'red.mp4')]);
  run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x54:r=10:d=4','-c:v','libx264','-pix_fmt','yuv420p',join(root,'blue.mp4')]);
  const edit={version:1,output:{width:96,height:54,fps:10},sources:[{id:'red',path:'red.mp4',proxy:null},{id:'blue',path:'blue.mp4',proxy:null}],cuts:[{src:'red',in:1,out:3,speed:2,at:2,track:0},{src:'blue',in:0,out:.5,at:0,track:2}],layers:[{id:'l',kind:'video',src:'blue.mp4',t:0,duration:4,track:1}],overlays:[],timeline:{tracks:[{id:'v1',kind:'video',ref:0},{id:'v2',kind:'video',ref:1},{id:'v3',kind:'video',ref:2}]}};
  for(const reverse of [false,true]){
   const temp=join(root,reverse?'above':'below');mkdirSync(temp);
   const plan=buildPlan({edit:{...edit,timeline:{tracks:reverse?[...edit.timeline.tracks].reverse():edit.timeline.tracks}},projectRoot:root,temporaryDirectory:temp,outputPath:join(temp,'out.mp4'),hasSourceAudio:true,capabilities:{sourceInputs:[{id:'red',path:join(root,'red.mp4'),hasAudio:true},{id:'blue',path:join(root,'blue.mp4'),hasAudio:false}],ffmpegCommand:'ffmpeg',ffprobeCommand:'ffprobe',chromePath:'chrome',hyperframesAvailable:false,puppeteerAvailable:false}});
   const commands=[plan.commands.cut,...(plan.commands.tail_pad?[plan.commands.tail_pad]:[]),plan.commands.track_stack.base,...plan.commands.track_stack.cutTracks.map(t=>t.command),...plan.commands.track_stack.stages.map(t=>t.command)];
   for(const command of commands)run(command.command,command.args);
   const output=plan.commands.track_stack.outputPath;
   const early=pixel(output,.25);assert.ok(early[2]>170&&early[0]<70,'second source and silent input map correctly');
   const rgb=pixel(output,2.5);assert.ok(reverse?rgb[0]>170&&rgb[2]<70:rgb[2]>170&&rgb[0]<70,`${reverse}: ${[...rgb]}`);
   const duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',output]).toString());assert.ok(Math.abs(duration-4)<.11);
   assert.ok(energy(output,1)<5,`audio before=${energy(output,1)}, during=${energy(output,2.3)}, after=${energy(output,3.5)}, filters=${plan.commands.cut.args[plan.commands.cut.args.indexOf('-filter_complex')+1]}`);assert.ok(energy(output,2.3)>100,'trimmed/sped audio follows moved cut');assert.ok(energy(output,3.5)<5,'audio ends with moved cut');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
