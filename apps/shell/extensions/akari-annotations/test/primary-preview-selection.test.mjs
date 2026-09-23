import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    publishPrimaryPreviewSelection('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
test('primary selection uses stable cut/caption ids and clears when selecting other media',()=>{
 const events=[];const Widget=new Function('window','CustomEvent','timeline_selection_model_1','TIMELINE_OVERLAY_SELECTED_EVENT','TIMELINE_LAYER_SELECTED_EVENT',`return class {${method}}`)({dispatchEvent:e=>events.push(e)},class{constructor(type,options){this.type=type;this.detail=options.detail}},{captionIdForTreeSelection:(s,id)=>id},'overlay','layer');
 const selected=[];
 const w=Object.assign(new Widget(),{cutItemIds:['cut-1'],layers:[],location:{editUri:{toString:()=>'/edit.json'}},rawKeyframeItem:()=>({source:{kind:'caption',id:'cue-a'}}),multiSelection:[],selectionModel:{set selectedCaptionIds(ids){selected.push(ids)}},applyCaptionStateClasses:()=>{}});
 for(const s of [{kind:'cut',index:0},{kind:'caption',id:'cue-b'},{kind:'item',id:'caption-item'},{kind:'layer',id:'layer-1'},undefined])w.publishPrimaryPreviewSelection(s);
 assert.deepEqual(events.filter(e=>e.type==='akari.timeline.primarySelected').map(e=>e.detail.selection),[{kind:'cut',id:'cut-1'},{kind:'caption',id:'cue-b'},{kind:'caption',id:'cue-a'},null,null]);
 assert.ok(events.every(e=>e.detail.editUri==='/edit.json'));
 assert.deepEqual(events.filter(e=>e.type==='akari.timeline.captionSelectionChanged').map(e=>e.detail.captionIds),[[],['cue-b'],['cue-a'],[],[]]);
 assert.deepEqual(selected,[[],['cue-b'],['cue-a'],[],[]]);
});

test('three caption IDs and the last clicked primary reach preview together',()=>{
 const events=[];const Widget=new Function('window','CustomEvent','timeline_selection_model_1','TIMELINE_OVERLAY_SELECTED_EVENT','TIMELINE_LAYER_SELECTED_EVENT',`return class {${method}}`)({dispatchEvent:e=>events.push(e)},class{constructor(type,options){this.type=type;this.detail=options.detail}},{captionIdForTreeSelection:()=>undefined},'overlay','layer');
 const w=Object.assign(new Widget(),{cutItemIds:[],layers:[],location:{editUri:{toString:()=>'/edit.json'}},multiSelection:['a','b','c'].map(id=>({kind:'caption',id})),selectionModel:{},applyCaptionStateClasses:()=>{}});
 w.publishPrimaryPreviewSelection({kind:'caption',id:'c'});
 assert.deepEqual(events.find(e=>e.type==='akari.timeline.captionSelectionChanged').detail,{editUri:'/edit.json',captionIds:['a','b','c'],primaryCaptionId:'c'});
 assert.deepEqual(w.selectionModel.selectedCaptionIds,['a','b','c']);
});

test('preview clicking a member preserves the timeline caption group',()=>{
 const rest=source.slice(source.indexOf('    handleCaptionSelection('));
 const method=rest.slice(0,rest.indexOf('\n    }')+6);
 const Widget=new Function(`return class {${method}}`)();
 const w=Object.assign(new Widget(),{
  captions:[{id:'a'},{id:'b'},{id:'c'}],multiSelection:['a','b','c'].map(id=>({kind:'caption',id})),
  canHandlePlaybackTick:()=>true,selectionRenderKeys:()=>[],
  applySelection:()=>{throw new Error('group was replaced')},revealPreviewSelection:()=>{}
 });
 w.handleCaptionSelection('/edit.json','b');
 assert.deepEqual(w.multiSelection.map(item=>item.id),['a','b','c']);
});

test('caption selection modifier uses Shift or the platform command key',()=>{
 const rest=source.slice(source.indexOf('    shouldToggleMultiSelection('));
 const method=rest.slice(0,rest.indexOf('\n    }')+6);
 const Widget=new Function('os_1',`return class {${method}}`)({isOSX:false});
 const widget=new Widget();
 const event=(shiftKey=false,metaKey=false,ctrlKey=false)=>({shiftKey,metaKey,ctrlKey});
 for(const [macOS,expected] of [[true,[true,true,false]],[false,[true,false,true]]]){
  assert.equal(widget.shouldToggleMultiSelection(event(),macOS),false);
  for(const [index,keys] of [event(true),event(false,true),event(false,false,true)].entries()){
   assert.equal(widget.shouldToggleMultiSelection(keys,macOS),expected[index],
    `${macOS?'macOS':'other OS'} modifier ${index}`);
  }
 }
});
