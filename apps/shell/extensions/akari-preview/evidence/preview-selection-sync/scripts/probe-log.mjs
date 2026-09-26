// 写真 A クリック → 指定位置クリックの前後で host⇄webview の選択メッセージと closure 状態を時系列で記録
import { clearLog, clickOutput, hostCdp, installProbe, sleep, snapshot, viewCdp } from './pss.mjs';
const [x = '450', y = '420', preX = '260', preY = '190'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
await clickOutput(host, view, Number(preX), Number(preY)); await sleep(1200);
await clearLog(view);
const t0 = Date.now();
await clickOutput(host, view, Number(x), Number(y));
const states = [];
for (let i = 0; i < 8; i++) { const s = await view.eval('window.__pssState'); states.push({ dt: Date.now() - t0, layer: s?.selectedLayerId, cut: s?.cutSelected, rcut: s?.requestedCutId }); await sleep(150); }
const s = await snapshot(host, view, 'after');
console.log(JSON.stringify(states));
for (const l of s.log) if (!/caption-zone-hover/.test(l.kind)) console.log(l.t - t0, l.kind, JSON.stringify(l.detail));
console.log('tl', JSON.stringify(s.timeline.selected), 'closure', JSON.stringify(s.closure));
host.close(); view.cdp.close(); process.exit(0);
