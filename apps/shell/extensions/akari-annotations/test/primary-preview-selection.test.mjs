import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    publishPrimaryPreviewSelection('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
test('primary selection uses stable cut/caption ids and clears when selecting other media',()=>{
 const events=[];const Widget=new Function('window','CustomEvent','timeline_selection_model_1',`return class {${method}}`)({dispatchEvent:e=>events.push(e.detail)},class{constructor(type,options){this.type=type;this.detail=options.detail}},{captionIdForTreeSelection:(s,id)=>id});
 const w=Object.assign(new Widget(),{cutItemIds:['cut-1'],location:{editUri:{toString:()=>'/edit.json'}},rawKeyframeItem:()=>({source:{kind:'caption',id:'cue-a'}})});
 for(const s of [{kind:'cut',index:0},{kind:'caption',id:'cue-b'},{kind:'item',id:'caption-item'},{kind:'layer',id:'layer-1'},undefined])w.publishPrimaryPreviewSelection(s);
 assert.deepEqual(events.map(e=>e.selection),[{kind:'cut',id:'cut-1'},{kind:'caption',id:'cue-b'},{kind:'caption',id:'cue-a'},null,null]);
 assert.ok(events.every(e=>e.editUri==='/edit.json'));
});
