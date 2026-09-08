import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    publishPrimaryPreviewSelection('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
test('primary selection uses stable cut/caption ids and clears when selecting other media',()=>{
 const events=[];const Widget=new Function('window','CustomEvent','timeline_selection_model_1','TIMELINE_OVERLAY_SELECTED_EVENT','TIMELINE_LAYER_SELECTED_EVENT',`return class {${method}}`)({dispatchEvent:e=>events.push(e)},class{constructor(type,options){this.type=type;this.detail=options.detail}},{captionIdForTreeSelection:(s,id)=>id},'overlay','layer');
 const w=Object.assign(new Widget(),{cutItemIds:['cut-1'],layers:[],location:{editUri:{toString:()=>'/edit.json'}},rawKeyframeItem:()=>({source:{kind:'caption',id:'cue-a'}})});
 for(const s of [{kind:'cut',index:0},{kind:'caption',id:'cue-b'},{kind:'item',id:'caption-item'},{kind:'layer',id:'layer-1'},undefined])w.publishPrimaryPreviewSelection(s);
 assert.deepEqual(events.filter(e=>e.type==='akari.timeline.primarySelected').map(e=>e.detail.selection),[{kind:'cut',id:'cut-1'},{kind:'caption',id:'cue-b'},{kind:'caption',id:'cue-a'},null,null]);
 assert.ok(events.every(e=>e.detail.editUri==='/edit.json'));
});
