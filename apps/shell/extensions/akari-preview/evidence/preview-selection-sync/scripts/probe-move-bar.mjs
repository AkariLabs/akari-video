// r0 の probe-move と同じ手順 + 各クリック前のミニバー（ホストの .is-placed）の出力座標を記録
import { evalOn } from './cdp-lib.mjs';
import { clearLog, clickOutput, dragOutput, hostCdp, installProbe, seek, sleep, snapshot, stageHost, viewCdp } from './pss.mjs';
const [project] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
const bar = async () => { const geo = await stageHost(host, view); const r = await evalOn(host, `(()=>[...document.querySelectorAll('[data-akari-ui="preview-context-layer"] .is-placed')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]}).filter(r=>r[2]>r[0]))()`); return r.map(q => [(q[0]-geo.x)/geo.w*1280,(q[1]-geo.y)/geo.h*720,(q[2]-geo.x)/geo.w*1280,(q[3]-geo.y)/geo.h*720].map(Math.round)); };
const snap = async n => { const s = await snapshot(host, view, n); console.log(n, JSON.stringify({ t: await view.eval(`Number(document.getElementById('seek').value)`), layer: s.closure?.selectedLayerId, cut: s.closure?.cutSelected, ov: s.closure?.requestedOverlayId, tl: s.timeline.selected, miniBar: await bar() })); };
await seek(host, project, 1); await sleep(1500);
await dragOutput(host, view, [220, 160], [260, 190]); await sleep(2500); await snap('moved-photo-a@1');
await seek(host, project, 0.5); await sleep(1500); await snap('seek0.5');
for (const [x, y] of [[450, 420], [220, 420], [120, 480]]) {
  await clickOutput(host, view, 260, 190); await sleep(1200); await snap('click-photo-a');
  await clickOutput(host, view, x, y); await sleep(1200); await snap(`click@(${x},${y})`);
}
host.close(); view.cdp.close(); process.exit(0);
