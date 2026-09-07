import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as store from '../../../../../packages/edit-store/lib/index.js';
import * as tracks from '../../../../../packages/edit-store/lib/visual-tracks.js';
import {insertCutIntoEdit} from '../lib/common/timeline-material-insert.js';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const start=source.indexOf('    async addMaterialAt('),rest=source.slice(start),method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function('edit_store_1','visual_tracks_1','timeline_material_insert_1',`return class {${method}}`)(store,tracks,{insertCutIntoEdit});
for(const shared of [false,true])test(`reimporting the same v0 source uses output slots (shared=${shared})`,async()=>{
 let value=JSON.stringify({version:0,source:{path:'red.webm',proxy:null},cuts:[{in:0,out:2}],layers:[],timeline:{tracks:[{id:'v1',kind:shared?'video':'cuts',ref:0}]}});
 const w=Object.assign(new Widget(),{location:{editUri:{}},timelineTracks:[],fileService:{readFile:async()=>({value})},messages:{error:assert.fail},hideNotice(){},footer:{},revealOutputPreview(){},reloadEdit:async()=>{},pushHistory(){},writeTimelineSnapshots:async next=>{value=next},errorMessage:e=>String(e),showNotice:assert.fail});
 await w.addMaterialAt('red.webm','video',0,0,{zone:'cuts',durationSeconds:4});
 const parsed=store.parseEdit(value);assert.equal(parsed.cuts.length,2);assert.equal(parsed.timeline.tracks.length,1);assert.equal(parsed.timeline.tracks[0].kind,'video');assert.deepEqual(parsed.cuts.map(c=>[c.in,c.out,c.at]),[[0,2,0],[0,4,2]]);
});
