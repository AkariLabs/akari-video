import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const store=require('@akari-video/edit-store');
const replacement=require('../lib/common/material-replacement.js');
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const start=source.search(new RegExp('    (async )?'+name+'\\('));assert.notEqual(start,-1,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n    }')+6);}
const deps={timeline_selection_model_1:{captionIdForTreeSelection:()=>undefined},material_replacement_1:replacement,edit_store_2:store,edit_store_4:store,
 edit_v2_mutations_1:require('../lib/common/edit-v2-mutations.js'),
 edit_load_failure_1:require('../lib/common/edit-load-failure.js'),
 timeline_collapsed_state_1:{TimelineCollapsedState:class{}},audio_master_1:{readAudioMasterSnapshot:()=>({})},
 caption_track_layout_1:{renderAroundCaptionDisplayReload:async(load,render)=>{await load();render();}},
 derive_timeline_tracks_1:{sortDefaultTimelineTracks:tracks=>tracks}};
const Widget=new Function(...Object.keys(deps),`return class {${['reloadEdit','selectedMaterialSwapTarget','selectedMaterialSwapItemId','restoreMaterialSwapSelection','pushSelectionSnapshot','applySelection','handleLayerSelection','handleCutSelection'].map(method).join('\n')}}`)(...Object.values(deps));
const fixture=()=>({version:2,output:{width:1280,height:720,fps:30},sources:[{id:'main',path:'main.mp4'},{id:'br',path:'assets/broll/br-city-walk-long/clip.mp4'}],tracks:[
 {id:'v1',lane:'visual',items:[{id:'main',at:0,duration:900,source:{kind:'media',src:'main',in:0,out:30}}]},
 {id:'v2',lane:'visual',items:[{id:'broll-1',at:0,duration:180,source:{kind:'media',src:'br',in:0,out:6,mute:false}}]}
]});
function harness(doc=fixture()){
 let ended=0;
 const w=Object.assign(new Widget(),{editReloadGeneration:0,location:{editUri:{toString:()=>'/edit.json'},root:{toString:()=>'/project'}},
  resolveLegacyEditForOpen:async text=>text,readEdit:text=>store.readInternalEdit(JSON.parse(text)),hydrateDocumentMotionReferences:async()=>{},
  invalidateContentExtent(){},itemLocations:new Map(),sourceMap:new Map(),layerTransitionWarnings:new Map(),timelineTreePartsByHtml:new Map(),timelineCollapsedIds:new Set(),treeRowsByTrack:new Map(),
  withSfxFade:()=>[],withNarrationEnvelope:items=>items??[],withBgmEnvelope:()=>undefined,pinAudioGroupToBottom:tracks=>tracks,
  rebuildSourceMap(){},showWarnings(){},showNotice:message=>{throw Error(message);},rebuildSegments(){},notifyCaptionSourceMappingWarning(){},
  applyStoredTrackFlags:async()=>{},syncTimelineTrackTogglesToPreview(){},loadTrackHeights:async()=>{},reloadGenerationSidecars:async()=>{},reloadResolvedCaptionDisplay:async()=>{},renderStrip(){},
  selectionKey:value=>JSON.stringify(value),publishPrimaryPreviewSelection(){},
  canHandlePlaybackTick:()=>true,exitTrimmerModeUnlessSelected(){},applySelectionClass(){},syncRightPane(){},revealOutputPreview(){},revealPreviewSelection(){},selectionModel:{},multiSelection:[],finishMaterialSwap:async()=>{ended++;},
  snapshotForSelection:selection=>selection.kind==='cut'?(w.cutItemIds[selection.index]?{kind:'cut',itemId:w.cutItemIds[selection.index]}:undefined)
   :selection.kind==='layer'?(w.layers.some(x=>x.id===selection.id)?{kind:'layer',id:selection.id}:undefined):selection,
  rawKeyframeItem:id=>replacement.locateSwapItem(w.editDocument,id)?.item,
  treeItemSnapshot:selection=>({kind:'item',id:selection.id})
 });
 return{w,doc,ended:()=>ended};
}
test('real reload keeps broll item selection when video cuts become image layers',async()=>{
 const {w,doc,ended}=harness();await w.reloadEdit(JSON.stringify(doc));
 assert.equal(w.cutItemIds[1],'broll-1');w.selection={kind:'cut',index:1};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual',currentRelativePath:doc.sources[1].path}};
 const next=replacement.replaceMaterial(doc,{itemId:'broll-1',relativePath:'assets/still/br-example/broll.png',kind:'image'});
 await w.reloadEdit(JSON.stringify(next));
 assert.ok(w.layers.some(x=>x.id==='broll-1'));assert.equal(w.cutItemIds.includes('broll-1'),false);
 assert.equal(ended(),0,'projection change is not a different item selection');
 assert.equal(w.selectedMaterialSwapTarget()?.itemId,'broll-1');
});
export { harness, fixture, Widget };

test('image layer becomes video cut without changing the selected item identity',async()=>{
 const image=replacement.replaceMaterial(fixture(),{itemId:'broll-1',relativePath:'assets/still/br-example/broll.png',kind:'image'});
 const {w,ended}=harness(image);await w.reloadEdit(JSON.stringify(image));w.selection={kind:'layer',id:'broll-1'};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual'}};
 const video=replacement.replaceMaterial(image,{itemId:'broll-1',relativePath:'assets/broll/br-other/clip.mp4',kind:'video',actualDurationS:2});
 await w.reloadEdit(JSON.stringify(video));assert.equal(ended(),0);
 assert.equal(w.selectedMaterialSwapItemId(),'broll-1');assert.equal(w.selection.kind,'cut');
});
test('audio metadata changes retain identity; real other selection and deselection end the trial',async()=>{
 const doc=fixture();doc.sources.push({id:'audio',path:'old.wav'});
 doc.tracks.push({id:'a1',lane:'audio',items:[{id:'audio-1',at:0,duration:60,source:{kind:'media',src:'audio',in:0,out:2}}]});
 const {w,ended}=harness(doc);await w.reloadEdit(JSON.stringify(doc));w.selection={kind:'audio',id:'audio-1'};
 w.materialSwap={target:{itemId:'audio-1',kind:'audio'}};
 const next=replacement.replaceMaterial(doc,{itemId:'audio-1',relativePath:'new.wav',kind:'audio',actualDurationS:1});
 await w.reloadEdit(JSON.stringify(next));assert.equal(ended(),0);
 w.selection={kind:'cut',index:0};w.pushSelectionSnapshot();assert.equal(ended(),1);
 w.selection=undefined;w.pushSelectionSnapshot();assert.equal(ended(),2);
});
test('eligibility changing alone is not another item selection',async()=>{
 const {w,doc,ended}=harness();await w.reloadEdit(JSON.stringify(doc));w.selection={kind:'cut',index:1};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual'}};
 w.selectedMaterialSwapTarget=()=>undefined;
 w.pushSelectionSnapshot();assert.equal(ended(),0);
});
test('actual deselection during an asynchronous reload is not resurrected',async()=>{
 const {w,doc,ended}=harness();await w.reloadEdit(JSON.stringify(doc));w.selection={kind:'cut',index:1};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual'}};
 const next=replacement.replaceMaterial(doc,{itemId:'broll-1',relativePath:'assets/still/br-example/broll.png',kind:'image'});
 let resume;w.resolveLegacyEditForOpen=text=>new Promise(resolve=>{resume=()=>resolve(text);});
 const reload=w.reloadEdit(JSON.stringify(next));w.selection=undefined;w.pushSelectionSnapshot();resume();await reload;
 assert.equal(w.selection,undefined);assert.ok(ended()>0);
});

test('preview reselection and tree selection of the same converted item stay active; an explicit clear ends it',async()=>{
 const {w,doc,ended}=harness();await w.reloadEdit(JSON.stringify(doc));w.selection={kind:'cut',index:1};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual'}};
 await w.reloadEdit(JSON.stringify(replacement.replaceMaterial(doc,{itemId:'broll-1',relativePath:'assets/still/br-example/broll.png',kind:'image'})));
 w.handleLayerSelection('/edit.json','broll-1');assert.equal(ended(),0);
 w.applySelection({kind:'item',id:'broll-1',itemKind:'media',trackId:'v2'},false);assert.equal(ended(),0);
 w.handleLayerSelection('/edit.json','broll-1');assert.equal(ended(),0);
 w.handleLayerSelection('/edit.json',null);assert.equal(ended(),1);
});

test('a shifted cut index cannot silently select another item during conversion',async()=>{
 const doc=fixture();doc.tracks.push({id:'v3',lane:'visual',items:[{id:'other-cut',at:300,duration:60,source:{kind:'media',src:'main',in:0,out:2}}]});
 const {w,ended}=harness(doc);await w.reloadEdit(JSON.stringify(doc));w.selection={kind:'cut',index:w.cutItemIds.indexOf('broll-1')};
 w.materialSwap={target:{itemId:'broll-1',kind:'visual'}};
 await w.reloadEdit(JSON.stringify(replacement.replaceMaterial(doc,{itemId:'broll-1',relativePath:'assets/still/br-example/broll.png',kind:'image'})));
 assert.equal(w.cutItemIds[1],'other-cut');assert.equal(ended(),0);assert.equal(w.selectedMaterialSwapItemId(),'broll-1');
});
