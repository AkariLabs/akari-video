import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const rest=source.slice(source.indexOf('    '+name+'('));return rest.slice(0,rest.indexOf('\n    }')+6)}
const Widget=new Function(`return class {${method('dropWouldOverlap')} ${method('showNotice')}}`)();
test('drag preview rejects frame overlap but allows touching edges, self and new tracks',()=>{
 const w=Object.assign(new Widget(),{frameAt:t=>Math.round(t*30),editDocument:{tracks:[{id:'v1',items:[{id:'a',at:30,duration:60}]}]}});
 assert.equal(w.dropWouldOverlap('b',2,1,'v1'),true);
 assert.equal(w.dropWouldOverlap('b',3,1,'v1'),false);
 assert.equal(w.dropWouldOverlap('b',0,1,'v1'),false);
 assert.equal(w.dropWouldOverlap('a',1,2,'v1'),false);
 assert.equal(w.dropWouldOverlap('b',1,2,'v1',1),false);
});
test('routine track-created notices are silent while actionable warnings remain',()=>{
 const messages=[];const w=Object.assign(new Widget(),{notice:{setMessage:m=>messages.push(m)}});
 w.showNotice('V1 を追加しました');w.showNotice('A2 を追加しました');w.showNotice('素材を読み込めません');
 assert.deepEqual(messages,['素材を読み込めません']);
});
