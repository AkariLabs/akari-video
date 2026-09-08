import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    computeContentEndDuration('));const method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function('edit_store_1',`return class {${method}}`)({collectExcludedCaptionIds:()=>new Set(['excluded'])});
test('timeline extent includes output captions and resolved BGM, while respecting excludes and trims',()=>{
 const w=Object.assign(new Widget(),{cuts:[{}],segments:[{tlEnd:5}],overlays:[],layers:[],audioSfx:[],audioNarration:[],timelineTreeTracks:[],captions:[{id:'a',timeDomain:'output',end:12},{id:'excluded',timeDomain:'output',end:100}],audioDurationCache:new Map()});
 assert.equal(w.computeContentEndDuration(),12);
 w.audioBgm={id:'bgm',path:'music'};w.audioDurationCache.set('music',30);w.rawV2Item=()=>({at:0,duration:0,source:{kind:'media',in:0}});assert.equal(w.computeContentEndDuration(),12);
 w.rawV2Item=()=>({at:0,duration:900,source:{kind:'media',in:0}});w.fps=30;assert.equal(w.computeContentEndDuration(),30);
 w.rawV2Item=()=>({at:0,duration:0,source:{kind:'media',in:5,out:10}});assert.equal(w.computeContentEndDuration(),12);
});
