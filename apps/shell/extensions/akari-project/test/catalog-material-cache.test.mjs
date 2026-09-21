import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as placement from '../lib/common/library-asset-placement.js';
const source=readFileSync(new URL('../lib/browser/akari-role-buckets-widget.js',import.meta.url),'utf8');
const start=source.indexOf('    async resolveCatalogMaterial('),rest=source.slice(start);
assert.notEqual(start,-1);
class URI {
 constructor(path){this.path=path;}resolve(path){return new URI(`${this.path}/${path}`);}
 toString(){return this.path;}relative(other){return other.path.startsWith(this.path+'/')?{toString:()=>other.path.slice(this.path.length+1)}:undefined;}
 static fromFilePath(path){return new URI(path);}
}
const Widget=new Function('library_asset_placement_1','uri_1',`return class {${rest.slice(0,rest.indexOf('\n    }')+6)}}`)(placement,{default:URI});
function fixture({category='audio',id='sfx-test',names=['sfx-test.mp3'],mediaUrl,missing=false,missingFile=false,state='available',origin='resolver'}={}) {
 let resolves=0,localReads=0,loads=0;
 const root=new URI('/project'),item={category,id,key:`${category}/${id}`,mediaUrl,state,origin};
 const directory=`/project/assets/${category}/${id}`;
 const w=Object.assign(new Widget(),{workflow:{workspaceRoot:root},assetCatalogItems:[item],resolvingAssetKeys:new Set(),update(){},
  messages:{warn(){},error(){}},toAssetBinChildren:stat=>stat.children,
  files:{resolve:async uri=>{
   localReads++;if(missing&&resolves===0)throw Error('not found');
   if(uri.path===directory)return{isDirectory:true,children:names.map(name=>({name,isDirectory:false}))};
   if(names.some(name=>uri.path===`${directory}/${name}`)){
    if(missingFile&&resolves===0)throw Error('file missing');
    return{isDirectory:false};
   }
   throw Error('file missing');
  }},
  projectService:{resolveAsset:async()=>{resolves++;return{success:true,projectAssetPath:directory};}},
  loadMaterials:async()=>{loads++;},loadAssetCatalogView:async()=>{throw Error('catalog fetch must not run');}
 });
 return{w,item,counts:()=>({resolves,localReads,loads})};
}
for(const config of [
 {},
 {category:'audio',id:'bgm-test',names:['take-a.mp3','take-b.mp3'],mediaUrl:'https://example.test/take-b.mp3'},
 {category:'still',id:'bg-test',names:['bg.png','preview.png','fragment.html']},
 {category:'broll',id:'br-test',names:['clip.mp4','meta.json']}
]) test(`installed ${config.id??'sfx'} is resolved locally without catalog/network/thumbnail reload`,async()=>{
 const f=fixture(config),result=await f.w.resolveCatalogMaterial(f.item.key,{preferExisting:true});
 assert.equal(result.cached,true);assert.equal(f.counts().resolves,0);assert.equal(f.counts().loads,0);
 assert.equal(f.counts().localReads,2);
 if(config.mediaUrl)assert.equal(result.relativePath,'assets/audio/bgm-test/take-b.mp3');
 if(config.category==='still')assert.equal(result.kind,'image');
});
test('missing files fall back to the existing resolver',async()=>{
 const f=fixture({missing:true});assert.deepEqual(await f.w.resolveCatalogMaterial(f.item.key,{preferExisting:true}),
  {relativePath:'assets/audio/sfx-test/sfx-test.mp3',kind:'audio',cached:false});
 assert.equal(f.counts().resolves,1);assert.equal(f.counts().loads,1);
});
test('callers without the trial option retain the existing resolver and response shape',async()=>{
 const f=fixture();assert.deepEqual(await f.w.resolveCatalogMaterial(f.item.key),{relativePath:'assets/audio/sfx-test/sfx-test.mp3',kind:'audio'});
 assert.equal(f.counts().resolves,1);
});
for(const config of [{state:'locked'},{origin:'local'}])test(`guard ${JSON.stringify(config)} also applies to cache hits`,async()=>{
 const f=fixture(config);assert.equal(await f.w.resolveCatalogMaterial(f.item.key,{preferExisting:true}),undefined);
 assert.deepEqual(f.counts(),{resolves:0,localReads:0,loads:0});
});
test('changing workspace while looking up cached files cannot return an old-project path',async()=>{
 const f=fixture(),read=f.w.files.resolve;
 f.w.files.resolve=async uri=>{const result=await read(uri);f.w.workflow.workspaceRoot=new URI('/other');return result;};
 assert.equal(await f.w.resolveCatalogMaterial(f.item.key,{preferExisting:true}),undefined);assert.equal(f.counts().resolves,0);
});

test('a directory entry without the actual media file is not a cache hit',async()=>{
 const f=fixture({missingFile:true});const result=await f.w.resolveCatalogMaterial(f.item.key,{preferExisting:true});
 assert.equal(result.cached,false);assert.equal(f.counts().resolves,1);
});
