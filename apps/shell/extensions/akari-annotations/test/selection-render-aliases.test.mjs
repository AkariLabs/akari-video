import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const r=source.slice(source.indexOf('    '+name+'('));return r.slice(0,r.indexOf('\n    }')+6)}
const Widget=new Function('timeline_selection_model_1',`return class {${method('selectionRenderKeys')} ${method('applySelectionClass')}}`)({captionIdForTreeSelection:(s,id)=>id});
test('preview tree item selection highlights its rendered HTML/cut/layer chip',()=>{
 const selected=new Map();const elements=[['overlay','html-a'],['layer','video-a'],['cut','0']].map(([kind,id])=>({dataset:{akariItemKind:kind,akariItemId:id},classList:{toggle:(name,on)=>selected.set(kind+':'+id,on)}}));
 const w=Object.assign(new Widget(),{multiSelection:[],selectionKey:s=>s?s.kind==='cut'?'cut:'+s.index:s.kind+':'+s.id:'',cutItemIds:['cut-a'],layers:[{id:'video-a'}],overlays:[{id:'html-a'}],rawKeyframeItem:()=>undefined,strip:{querySelectorAll:()=>elements},trackHeaders:{querySelectorAll:()=>[]},applyCaptionStateClasses(){}});
 for(const [id,key] of [['html-a','overlay:html-a'],['video-a','layer:video-a'],['cut-a','cut:0']]){w.selection={kind:'item',id};w.applySelectionClass();assert.equal(selected.get(key),true);assert.equal([...selected.values()].filter(Boolean).length,1)}
});
