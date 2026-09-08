import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/node/akari-preview-service.ts',import.meta.url),'utf8');
const script=source.split('const ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT = `')[1].split('`;')[0];
test('overlay soft remount retains the same caption and transition hosts',async()=>{
 const caption={hasAttribute:()=>false},transition={hasAttribute:()=>false};
 const stage={children:[],append(...nodes){this.children.push(...nodes)}};
 const runtime={async mount(){stage.children=[]},tick(){}};
 const state={summary:{overlays:[]}};
 vm.runInNewContext(script,{window:{akari:{runtime,state}},document:{getElementById:()=>stage,querySelectorAll:()=>[]},console});
 await runtime.mount(state.summary);stage.append(caption,transition);
 state.summary={overlays:[{id:'changed'}]};runtime.tick(2,false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(stage.children.includes(caption));assert.ok(stage.children.includes(transition));
 state.summary={overlays:[{id:'changed-again'}]};runtime.tick(3,false);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(stage.children.filter(n=>n===caption).length,1);
});
