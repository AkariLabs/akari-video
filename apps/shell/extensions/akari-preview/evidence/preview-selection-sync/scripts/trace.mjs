// handleVisualMediaPointerDown の中の分岐をログポイントで記録する
import { clickOutput, hostCdp, seek, sleep, viewCdp } from './pss.mjs';
const [project] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp();
const scripts = []; view.cdp.on('Debugger.scriptParsed', p => scripts.push(p)); await view.cdp.send('Debugger.enable'); await sleep(800);
const marks = [
  ['enter', 'const handleVisualMediaPointerDown = event => {', 1, `({target: event.target?.id || event.target?.tagName, layer: selectedLayerId, cap: selectedCaptionId})`],
  ['afterMarquee', 'if (window.akari.shouldStartPreviewMarquee?.(event)) return;', 1, `({})`],
  ['hit', 'const hit = coveredDomHit || findVisualMediaHitAt(event);', 1, `({hit: hit && (hit.id || hit.dataset?.akariLayerId || hit.tagName)})`],
  ['release', 'const isSelectionReleaseTarget = event => {', 1, `({target: event.target?.id || event.target?.tagName})`],
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
await clickOutput(host, view, 220, 160); await sleep(1200);
await view.eval('(window.__trace = [], true)');
await clickOutput(host, view, 450, 420); await sleep(1200);
console.log(JSON.stringify(await view.eval('window.__trace'), null, 0));
host.close(); view.cdp.close(); process.exit(0);
