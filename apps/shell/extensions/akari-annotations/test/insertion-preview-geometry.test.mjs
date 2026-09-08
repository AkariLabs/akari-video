import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    positionInsertionGhost('));
const method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function('RULER_BAND_HEIGHT_PX',`return class {${method}}`)(14);
test('insertion preview stays inside the viewport without changing its time span',()=>{
 const w=Object.assign(new Widget(),{stripScroll:{clientHeight:200,scrollTop:300}});
 for(const [top,height] of [[300,60],[499,60],[0,60],[499,500]]){
  const ghost={style:{left:'25%',width:'12%'},dataset:{}};
  w.positionInsertionGhost(ghost,top,height);
  assert.ok(parseFloat(ghost.style.top)>=16);
  assert.ok(parseFloat(ghost.style.top)+parseFloat(ghost.style.height)<=212);
  assert.equal(ghost.style.left,'25%');assert.equal(ghost.style.width,'12%');
  assert.equal(ghost.style.border,'2px solid #f97316');assert.equal(ghost.dataset.akariInsertionPreview,'true');
 }
});
