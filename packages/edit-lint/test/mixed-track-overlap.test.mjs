import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {lintProject} from '../src/edit-lint.mjs';
async function check(edit){const dir=await mkdtemp(join(tmpdir(),'akari-mixed-track-'));try{await writeFile(join(dir,'main.mp4'),'fixture');await writeFile(join(dir,'title.html'),'<div>title</div>');await writeFile(join(dir,'title.mov'),'fixture');await writeFile(join(dir,'edit.json'),JSON.stringify(edit));return await lintProject(dir,{writeReports:false});}finally{await rm(dir,{recursive:true,force:true})}}
const video=(id,at,duration)=>({id,at,duration,source:{kind:'media',src:'main',in:0,out:duration/30}});
const fixture=()=>({version:2,output:{width:640,height:360,fps:30},sources:[{id:'main',path:'main.mp4'}],tracks:[
 {id:'base-track',lane:'visual',items:[video('base',0,300)]},
 {id:'mixed-track',lane:'visual',items:[{id:'title',at:0,duration:30,source:{kind:'html',path:'title.html'}},video('upper',60,180)]}
]});
test('media on a mixed track may overlap media on a different actual track',async()=>{const result=await check(fixture());assert.equal(result.verdict,'pass',JSON.stringify(result.findings));assert.ok(!result.findings.some(f=>f.check==='cuts.track-overlap'))});
test('real overlap within one v2 track is still rejected',async()=>{const edit=fixture();edit.tracks[1].items[1].at=15;const result=await check(edit);assert.equal(result.verdict,'fail');assert.ok(result.findings.some(f=>f.check==='v2.track-no-overlap'&&f.severity==='error'))});
test('overlapping media siblings on a single track are still rejected',async()=>{const edit=fixture();edit.tracks[0].items.push(video('collision',30,60));const result=await check(edit);assert.equal(result.verdict,'fail');assert.ok(result.findings.some(f=>f.check==='v2.track-no-overlap'))});

test('a baked telop followed by video keeps the video on its actual separate track',async()=>{const edit=fixture();edit.tracks[1].items[0].source={kind:'telop',preset:'ref3_name_rounded',params:{title:'title',name:'name'},baked:'title.mov'};const result=await check(edit);assert.equal(result.verdict,'pass',JSON.stringify(result.findings))});
