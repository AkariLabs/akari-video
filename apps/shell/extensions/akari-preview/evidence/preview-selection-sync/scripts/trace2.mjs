// 回帰 r1 用: findVisualMediaHitAt の hits と marquee 判定をログポイントで記録（ラッパー作成の検証スクリプト）
import { clickOutput, hostCdp, seek, sleep, viewCdp } from './pss.mjs';
const [project, px = '450', py = '420', pre = 'photo'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp();
const scripts = []; view.cdp.on('Debugger.scriptParsed', p => scripts.push(p)); await view.cdp.send('Debugger.enable'); await sleep(800);
const marks = [
  ['enter', 'const handleVisualMediaPointerDown = event => {', 1, `({target: event.target?.id || event.target?.tagName, ov: event.target?.closest?.('[data-overlay-id]')?.getAttribute('data-overlay-id'), layer: selectedLayerId, cap: selectedCaptionId})`],
  ['hits', 'return typeof frontmostPreviewHitFn === \'function\' ? frontmostPreviewHitFn(hits)', 0, `({hits: hits.map(h => ({id: h.element.id || h.element.dataset?.akariLayerId, z: h.z, o: h.order, disp: h.element.style.display, vis: h.element.style.visibility, op: h.element.style.opacity}))})`],
  ['marq', 'const allow = !blocked && (zoom > 1.05', 0, `({blocked, mediaHit: mediaHit && (mediaHit.id || mediaHit.dataset?.akariLayerId), target: event.target?.id || event.target?.tagName, ov: event.target?.closest?.('[data-overlay-id]')?.getAttribute('data-overlay-id')})`],
  ['hit', 'const hit = coveredDomHit || findVisualMediaHitAt(event);', 1, `({hit: hit && (hit.id || hit.dataset?.akariLayerId || hit.tagName)})`],
];
let found = 0;
for (const s of scripts) {
  let src; try { src = (await view.cdp.send('Debugger.getScriptSource', { scriptId: s.scriptId })).scriptSource; } catch { continue; }
  if (!src.includes(marks[0][1])) continue;
  for (const [name, m, off, expr] of marks) {
    const idx = src.indexOf(m); if (idx < 0) { console.log('missing', name); continue; }
    const line = src.slice(0, idx).split('\n').length - 1 + off;
    await view.cdp.send('Debugger.setBreakpoint', { location: { scriptId: s.scriptId, lineNumber: line, columnNumber: 0 }, condition: `((window.__trace = window.__trace || []).push({ n: ${JSON.stringify(name)}, ...${expr} }), false)` });
    found++;
  }
}
console.log('breakpoints', found);
await seek(host, project, 0.5); await sleep(1500);
const preAt = { photo: [220, 160], none: null }[pre];
if (preAt) { await clickOutput(host, view, ...preAt); await sleep(1200); }
const layers = await view.eval(`Array.from(document.querySelectorAll('[data-akari-layer-id]')).map(e => ({id: e.dataset.akariLayerId, disp: e.style.display, vis: e.style.visibility, op: e.style.opacity, z: e.style.zIndex}))`);
console.log('layers', JSON.stringify(layers));
const ovs = await view.eval(`Array.from(document.querySelectorAll('[data-overlay-id]')).map(e => ({id: e.getAttribute('data-overlay-id'), vis: getComputedStyle(e).visibility, disp: getComputedStyle(e).display, pe: getComputedStyle(e).pointerEvents, z: e.style.zIndex}))`);
console.log('overlays', JSON.stringify(ovs));
await view.eval('(window.__trace = [], true)');
await clickOutput(host, view, Number(px), Number(py)); await sleep(1200);
console.log(JSON.stringify(await view.eval('window.__trace'), null, 0));
console.log('state', JSON.stringify(await view.eval(`({ layerSel: document.getElementById('layer-select-box')?.style.display, cutSel: document.getElementById('cut-select-box')?.style.display, ix: window.akari.interaction?.selectedId })`)));
host.close(); view.cdp.close(); process.exit(0);
