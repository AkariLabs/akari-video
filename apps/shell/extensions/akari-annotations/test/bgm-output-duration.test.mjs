import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const rest=source.slice(source.indexOf('    '+name+'('));return rest.slice(0,rest.indexOf('\n    }')+6)}
const Widget=new Function(`return class {${method('outputEndDuration')} ${method('totalDuration')}}`)();
function fixture(){return Object.assign(new Widget(),{segments:[{tlEnd:72}],layers:[],audioSfx:[],audioNarration:[],viewStart:0,viewDuration:144,contentEndDuration:()=>72,narrationDisplayDuration:n=>n.duration})}
test('BGM ends at 72 seconds regardless of scrolling and zoom padding',()=>{const w=fixture();assert.equal(w.outputEndDuration(),72);assert.equal(w.totalDuration(),144);w.viewStart=180;w.viewDuration=60;assert.equal(w.totalDuration(),240);assert.equal(w.outputEndDuration(),72)});
test('timed narration and effects extend output; BGM and editor-only markers do not',()=>{const w=fixture();w.audioBgm={duration:300};w.overlays=[{start:200,duration:20}];w.audioSfx=[{t:70,duration:5}];assert.equal(w.outputEndDuration(),75);w.audioNarration=[{t:80,duration:3}];assert.equal(w.outputEndDuration(),83)});
test('BGM alone does not invent a ten-second output',()=>{const w=fixture();w.segments=[];assert.equal(w.outputEndDuration(),0)});
