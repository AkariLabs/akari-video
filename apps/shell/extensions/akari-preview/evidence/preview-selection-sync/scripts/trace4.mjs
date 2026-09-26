// findVisualMediaHitAt の layer ごとの判定材料を記録（ドラッグ後の状態で）
import { clickOutput, hostCdp, sleep, viewCdp } from './pss.mjs';
const [x = '450', y = '420'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp();
const scripts = []; view.cdp.on('Debugger.scriptParsed', p => scripts.push(p)); await view.cdp.send('Debugger.enable'); await sleep(1000);
const marks = [
  ['enter', 'const handleVisualMediaPointerDown = event => {', 1, `({target: event.target?.id, layer: selectedLayerId})`],
  ['layerPush', "hits.push({ element: entry.video, z: Number(entry.video.style.zIndex) || 0, order: order++ });", 0, `({id: entry.spec.id, tf: layerVisualTransformNow(entry), spec: {x: entry.spec.x, y: entry.spec.y, scale: entry.spec.scale, t: entry.spec.t, transform: entry.spec.transform}, nat: [entry.video.naturalWidth, entry.video.videoWidth], hasAlpha: !!entry.video.akariPhotoHitAlpha, sp: typeof sourcePoint})`],
  ['hits', 'return typeof frontmostPreviewHitFn === \'function\' ? frontmostPreviewHitFn(hits)', 0, `({hits: hits.map(h => ({id: h.element.id || h.element.dataset?.akariLayerId, z: h.z, o: h.order}))})`],
  ['hit', 'const hit = coveredDomHit || findVisualMediaHitAt(event);', 1, `({hit: hit && (hit.id || hit.dataset?.akariLayerId || hit.tagName)})`],
];
let found = 0;
for (const s of scripts) {
  let src; try { src = (await view.cdp.send('Debugger.getScriptSource', { scriptId: s.scriptId })).scriptSource; } catch { continue; }
  if (!src.includes(marks[0][1])) continue;
  for (const [name, m, off, expr] of marks) {
    const idx = src.indexOf(m); if (idx < 0) { console.log('missing', name); continue; }
    const line = src.slice(0, idx).split('\n').length - 1 + off;
    const r = await view.cdp.send('Debugger.setBreakpoint', { location: { scriptId: s.scriptId, lineNumber: line, columnNumber: 0 }, condition: `((window.__trace = window.__trace || []).push({ n: ${JSON.stringify(name)}, ...${expr} }), false)` });
    found++;
  }
}
console.log('breakpoints', found, 'scripts', scripts.length);
await clickOutput(host, view, 260, 190); await sleep(1000);
await view.eval('(window.__trace = [], true)');
await clickOutput(host, view, Number(x), Number(y)); await sleep(1000);
for (const s of await view.eval('window.__trace')) console.log(JSON.stringify(s));
host.close(); view.cdp.close(); process.exit(0);
