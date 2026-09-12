import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    positionInsertionGhost('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function('RULER_BAND_HEIGHT_PX',`return class {${method}}`)(14);
// 録音帯レーンぶんのルーラー行高はインスタンス側で差し込む（new Function の行は基点のまま保つ）。
const widget=rulerHeightPx=>Object.assign(new Widget(),{
 rulerHeightPx,rulerRowHeightPx(){return this.rulerHeightPx;},
 stripScroll:{clientHeight:200,scrollTop:300}});
test('insertion preview stays inside the viewport without changing its time span',()=>{
 const w=widget(14);
 for(const [top,height] of [[300,60],[499,60],[0,60],[499,500]]){
  const ghost={style:{left:'25%',width:'12%'},dataset:{}};
  w.positionInsertionGhost(ghost,top,height);
  assert.ok(parseFloat(ghost.style.top)>=16);
  assert.ok(parseFloat(ghost.style.top)+parseFloat(ghost.style.height)<=212);
  assert.equal(ghost.style.left,'25%');assert.equal(ghost.style.width,'12%');
  assert.equal(ghost.style.border,'2px solid #f97316');assert.equal(ghost.dataset.akariInsertionPreview,'true');
 }
});
test('recording lane keeps the legacy top when hidden and shifts insertion preview when visible',()=>{
 const w=widget(14);
 const hidden={style:{},dataset:{}};
 w.positionInsertionGhost(hidden,300,60);
 assert.equal(parseFloat(hidden.style.top),16);
 w.rulerHeightPx=32;
 const visible={style:{},dataset:{}};
 w.positionInsertionGhost(visible,300,60);
 assert.equal(parseFloat(visible.style.top),34);
 assert.equal(parseFloat(visible.style.top)-parseFloat(hidden.style.top),18);
});
