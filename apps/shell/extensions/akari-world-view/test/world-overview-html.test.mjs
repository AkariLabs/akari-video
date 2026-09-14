import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { worldOverviewHtml } = require('../lib/common/world-overview-html.js');

test('overview is self-contained and safely embeds sources and JSON', () => {
  const html = worldOverviewHtml({ runtimeSource: '/* runtime-token */', cameraSource: '/* camera-token */', worldMapJson: '{"schemaVersion":3,"kind":"flat","worlds":[],"zones":[],"cameraStops":[],"edges":[],"x":"</script>"}', seconds: 2 });
  assert.doesNotMatch(html, /<script\s+src/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /runtime-token/); assert.match(html, /camera-token/);
  assert.doesNotMatch(html, /<\/script>"/);
  assert.match(html, /\\u003c\/script>/);
});

const flat = JSON.stringify({ schemaVersion: 3, kind: 'flat', worlds: [{ id: 'w', flat: { bounds: [0, 0, 100, 100] } }], zones: [], cameraStops: [{ id: 'a', world: 'w', c: [10, 20, 1], at: 0, leave: 1 }], edges: [] });
const spatial = JSON.stringify({ schemaVersion: 3, kind: 'spatial', worlds: [{ id: 'w', spatial: { c: [0, 0, 0] } }], zones: [{ id: 'a', world: 'w', c: [0, 0, 0] }], cameraStops: [{ id: 'a', world: 'w', eye: [0, 0, 1], target: [0, 0, 0], at: 0, leave: 1 }], edges: [] });

test('flat は停留所描画・⌥ ドラッグ・書き戻しメッセージを含む', () => {
  const html = worldOverviewHtml({ runtimeSource: '', cameraSource: '', worldMapJson: flat, seconds: 0 });
  assert.match(html, /⌥ ドラッグで停留所を移動/);
  assert.match(html, /function drawStops/);
  assert.match(html, /akari-world-move-stop/);
  assert.match(html, /akari-world-map/);
  assert.match(html, /akari-world-move-failed/);
  assert.match(html, /__akariWorldOverview/);
  assert.doesNotMatch(html, /<script\s+src/i); assert.doesNotMatch(html, /https?:\/\//i);
});

test('spatial は編集不可の文言を含む', () => {
  const html = worldOverviewHtml({ runtimeSource: '', cameraSource: '', worldMapJson: spatial, seconds: 0 });
  assert.match(html, /spatial は移動できません/);
  assert.match(html, /editable=rawMap\.kind!==['"]spatial['"]/);
});

test('error は編集状態を作る前に return する', () => {
  const html = worldOverviewHtml({ runtimeSource: '', cameraSource: '', worldMapJson: '', seconds: 0, error: 'broken' });
  assert.ok(html.indexOf('if(problem)') < html.indexOf('const editable'));
  assert.match(html, /box\.textContent=problem;return/);
});

test('runtime 描画例外は canvas を消去して停留所を描き、同じエラーの toast は 1 回だけにする', () => {
  const html = worldOverviewHtml({ runtimeSource: '', cameraSource: '', worldMapJson: flat, seconds: 0 });
  const start = html.indexOf('function drawOverview()');
  const end = html.indexOf('\nfunction canvasPoint', start);
  assert.ok(start >= 0 && end > start);
  const drawOverviewSource = html.slice(start, end);
  const run = new Function(`
    let seconds=0,lastDrawError=null,lastDrawToast=null,toastCount=0,clearCount=0,stopCount=0;
    const map={cameraStops:[]},activeMap=()=>map,overviewView=()=>({}),descriptor=value=>value;
    const canvas={width:1280,height:720,getContext:()=>({clearRect:()=>{clearCount+=1}})},out={};
    const window={akari:{worldRuntime:{drawOverview:()=>{throw new Error('label は未知のキーです')}}}};
    function showToast(){toastCount+=1} function drawStops(){stopCount+=1}
    ${drawOverviewSource}
    drawOverview(); drawOverview();
    return {toastCount,clearCount,stopCount,lastDrawError};
  `)();
  assert.deepEqual(run, { toastCount: 1, clearCount: 2, stopCount: 2, lastDrawError: 'label は未知のキーです' });
  assert.match(html, /lastDrawError:\(\)=>lastDrawError/);
});

test('移動失敗と map 更新失敗は toast を再描画より先に確定する', () => {
  const html = worldOverviewHtml({ runtimeSource: '', cameraSource: '', worldMapJson: flat, seconds: 0 });
  assert.match(html, /catch\(error\)\{workingMap=null;pendingRequest=null;showToast\([^}]+\);drawOverview\(\)\}/);
  assert.match(html, /akari-world-move-failed[^}]+\{workingMap=null;pendingRequest=null;showToast\(message\.reason\);drawOverview\(\)\}/);
});
