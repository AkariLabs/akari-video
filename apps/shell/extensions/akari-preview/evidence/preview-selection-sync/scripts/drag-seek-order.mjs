// 差し戻し 2: ドラッグ → 直後に 6 秒へ。webview の報告（out:）と host からの選択メッセージ（in:）と timeline の選択を時系列で
import { evalOn } from './cdp-lib.mjs';
import { dragOutput, hostCdp, installProbe, seek, sleep, viewCdp, TIMELINE } from './pss.mjs';
const [project, kind = 'shape', wait = '300'] = process.argv.slice(2);
const FIXED = { shape: [520, 240], photo: [220, 160], html: [1030, 120] };
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
await seek(host, project, 1); await sleep(1200);
await view.eval(`(()=>{ window.__pssLog = []; const o = window.__pssPush; window.__pssPush = (k, d) => { if (!/hover|set-selected-captions/.test(k)) o(k, d); }; return true })()`);
const t0 = Date.now(); const tl = [];
const poll = (async () => { let last = ''; while (Date.now() - t0 < 9000) { const s = JSON.stringify((await evalOn(host, TIMELINE)).selected); if (s !== last) { tl.push([Date.now() - t0, 'timeline', s]); last = s; } await sleep(100); } })();
const d = await dragOutput(host, view, FIXED[kind], [FIXED[kind][0] + 40, FIXED[kind][1] + 30]); tl.push([Date.now() - t0, 'drag-done']);
await sleep(Number(wait)); tl.push([Date.now() - t0, 'seek6']); await seek(host, project, 6); tl.push([Date.now() - t0, 'seek6-done']);
await poll;
const log = (await view.eval('window.__pssLog')).filter(l => !/hover|set-selected-captions/.test(l.kind)).map(l => [l.t - t0, l.kind, JSON.stringify(l.detail).slice(0, 120)]);
for (const e of [...log, ...tl].sort((a, b) => a[0] - b[0])) console.log(e.join('  '));
process.exit(0);
