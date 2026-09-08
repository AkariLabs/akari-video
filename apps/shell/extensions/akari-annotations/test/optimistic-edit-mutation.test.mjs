import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const i=source.search(new RegExp('    (async )?'+name+'\\('));const r=source.slice(i);return r.slice(0,r.indexOf('\n    }')+6)}
const Widget=new Function('edit_v2_mutations_1',`return class {${method('commitEditMutation')} ${method('performEditMutation')}}`)({prepareV2KeyframeDistribution:document=>({document,writes:[]}),stringifyEditV2:JSON.stringify});
function fixture(){let disk=JSON.stringify({version:2,value:0});const w=Object.assign(new Widget(),{editMutationTail:Promise.resolve(),location:{editUri:'edit'},fileService:{readFile:async()=>({value:disk})},prepareMotionChanges:async()=>[],writeMotionChanges:async()=>{},pushHistory:()=>{},reloadEdit:async source=>{w.ui=JSON.parse(source??disk).value},writeEditSnapshotGuarded:async s=>{disk=s}});return {w,disk:()=>JSON.parse(disk).value,setDisk:s=>{disk=s}}}
test('move renders before save, and queued moves read the previous saved result',async()=>{
 const {w,disk,setDisk}=fixture();let finish,entered;const saving=new Promise(r=>entered=r);let writes=0;
 w.writeEditSnapshotGuarded=async s=>{if(++writes===1){entered();await new Promise(r=>finish=r)}setDisk(s)};
 const move=doc=>({...doc,value:doc.value+1});const first=w.commitEditMutation('move',move,{optimistic:true});await saving;
 assert.equal(w.ui,1);assert.equal(disk(),0);const second=w.commitEditMutation('move',move,{optimistic:true});finish();await Promise.all([first,second]);assert.equal(w.ui,2);assert.equal(disk(),2);
});
test('failed save restores the disk snapshot',async()=>{const {w,disk}=fixture();w.writeEditSnapshotGuarded=async()=>{throw Error('write failed')};await assert.rejects(w.commitEditMutation('move',doc=>({...doc,value:1}),{optimistic:true}));assert.equal(w.ui,0);assert.equal(disk(),0)});
