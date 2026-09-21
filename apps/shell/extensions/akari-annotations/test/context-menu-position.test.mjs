import test from 'node:test';
import assert from 'node:assert/strict';
import { contextMenuPosition } from '../lib/common/context-menu-position.js';
import { openTimelineContextMenu, closeTimelineContextMenu } from '../lib/browser/akari-timeline-context-menu.js';
for (const [point, expected] of [[{x:100,y:80},{left:100,top:80}], [{x:990,y:790},{left:816,top:476}], [{x:-20,y:-5},{left:4,top:4}]]) {
 test(`menu position ${JSON.stringify(point)}`, () => assert.deepEqual(contextMenuPosition(point,{width:180,height:320},{width:1000,height:800}),expected));
}
test('oversized menu stays at the margin and the DOM limits it to the viewport', () => {
 assert.deepEqual(contextMenuPosition({x:90,y:90},{width:1500,height:1200},{width:1000,height:800}),{left:4,top:4});
});
test('DOM menu measures after attaching, clamps its actual size and keeps actions in order', () => {
 const oldDocument=globalThis.document, oldWindow=globalThis.window, oldTimeout=globalThis.setTimeout;
 let attached=false, popup, selected;
 const element = () => ({style:{},dataset:{},children:[],listeners:{},setAttribute(){},appendChild(child){this.children.push(child);},
  addEventListener(name,fn){this.listeners[name]=fn;}, getBoundingClientRect(){assert.equal(attached,true);return {width:180,height:320};},remove(){},contains(){return true;}});
 globalThis.window={innerWidth:1000,innerHeight:800}; globalThis.setTimeout=()=>0;
 globalThis.document={createElement:element,body:{appendChild(el){attached=true;popup=el;}},addEventListener(){}};
 try {
  openTimelineContextMenu({x:990,y:790,items:[{id:'a',label:'A'},{id:'swap',label:'入れ替え…'}],onSelect:id=>{selected=id;}});
  assert.equal(popup.style.left,'816px');assert.equal(popup.style.top,'476px'); assert.equal(popup.style.maxHeight,'calc(100vh - 8px)');
  assert.deepEqual(popup.children.map(c=>c.dataset.akariContextItem),['a','swap']);
  popup.children[1].listeners.click({});assert.equal(selected,'swap');closeTimelineContextMenu();
 } finally {globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.setTimeout=oldTimeout;}
});
