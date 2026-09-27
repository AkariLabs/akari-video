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
test('overlay soft remount restores the container presentation, not the same-id hover frame',async()=>{
 const element=(attrs,style)=>({attrs:{...attrs},style:{...style},hasAttribute(n){return n in this.attrs},getAttribute(n){return n in this.attrs?this.attrs[n]:null},setAttribute(n,v){this.attrs[n]=String(v)},removeAttribute(n){delete this.attrs[n]}});
 const stage={children:[],append(...nodes){this.children.push(...nodes)}};
 let container=element({'data-overlay-id':'shape-2','data-akari-track':'0'},{zIndex:'3',display:''});
 // interaction.js のホバー枠は body 直下に同じ data-overlay-id を持って z-index: 90 で居る。
 const hover=element({'data-overlay-id':'shape-2','data-akari-ui':'preview-hover-frame'},{zIndex:'90',display:''});
 stage.children=[container];
 const querySelectorAll=selector=>selector==='[data-overlay-id]'?[...stage.children,hover]
  :selector==='#overlay-stage > [data-overlay-id]'?[...stage.children]:[];
 const runtime={async mount(){container=element({'data-overlay-id':'shape-2'},{zIndex:'',display:''});stage.children=[container]},tick(){}};
 const state={summary:{overlays:[{id:'shape-2'}]}};
 vm.runInNewContext(script,{window:{akari:{runtime,state}},document:{getElementById:()=>stage,querySelectorAll},console});
 await runtime.mount(state.summary);
 container.attrs['data-akari-track']='0';container.style.zIndex='3';
 state.summary={overlays:[{id:'shape-2',transform:{x:1}}]};runtime.tick(2,false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(container.style.zIndex,'3');assert.equal(container.getAttribute('data-akari-track'),'0');
 assert.equal(hover.style.zIndex,'90');
});
