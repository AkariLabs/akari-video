// 任意の手順を 1 本で: node probe-seq.mjs <project> '<json steps>'  steps: ["seek",t] ["click",x,y] ["tl",id,mod] ["wait",ms] ["snap",name]
import { clearLog, clickOutput, clickTimelineItem, hostCdp, installProbe, seek, sleep, snapshot, viewCdp } from './pss.mjs';
const [project, stepsJson] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
for (const [op, a, b] of JSON.parse(stepsJson)) {
  if (op === 'seek') await seek(host, project, a);
  else if (op === 'click') { await clearLog(view); await clickOutput(host, view, a, b); await sleep(1200); }
  else if (op === 'tl') { await clearLog(view); await clickTimelineItem(host, a, b ?? 0); await sleep(1500); }
  else if (op === 'wait') await sleep(a);
  else if (op === 'snap') { const s = await snapshot(host, view, a); console.log(a, JSON.stringify({ t: await view.eval(`Number(document.getElementById('seek').value)`), cap: s.closure?.selectedCaptionId, ov: s.closure?.requestedOverlayId, layer: s.closure?.selectedLayerId, cut: s.closure?.cutSelected, ix: s.ix?.selectedId, tl: s.timeline.selected, out: s.log.filter(l => l.kind.startsWith('out')).map(l => l.kind.slice(10) + JSON.stringify(l.detail)) })); }
}
host.close(); view.cdp.close(); process.exit(0);
