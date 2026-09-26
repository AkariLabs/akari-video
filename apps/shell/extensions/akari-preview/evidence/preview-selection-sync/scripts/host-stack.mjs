// 差し戻し 2: ドラッグ直後のシークの後、タイムラインが選択を再送する呼び出し元（ホストの dispatchEvent をラップしてスタックを記録）
import { evalOn } from './cdp-lib.mjs';
import { dragOutput, hostCdp, installProbe, seek, sleep, viewCdp } from './pss.mjs';
const [project, kind = 'photo', wait = '300'] = process.argv.slice(2);
const FIXED = { shape: [520, 240], photo: [220, 160], html: [1030, 120] };
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
await seek(host, project, 1); await sleep(1200);
await evalOn(host, `(()=>{ window.__hs = []; window.__hsT0 = Date.now(); if (!window.__hsWrapped) { const o = window.dispatchEvent.bind(window); window.dispatchEvent = ev => { if (/primarySelected|timeline\\.layerSelected|timeline\\.overlaySelected|preview\\.layerSelected|preview\\.overlaySelected|preview\\.cutSelected/.test(ev.type)) window.__hs.push({ dt: Date.now() - window.__hsT0, type: ev.type, detail: JSON.stringify(ev.detail).slice(0, 120), stack: new Error().stack.split('\\n').slice(2, 9).map(s => s.trim().replace(/\\(.*\\/([^/]+):(\\d+):\\d+\\)/, '($1:$2)')).join(' < ') }); return o(ev); }; window.__hsWrapped = true; } return true })()`);
await dragOutput(host, view, FIXED[kind], [FIXED[kind][0] + 40, FIXED[kind][1] + 30]);
await sleep(Number(wait)); await evalOn(host, `(window.__hs.push({ dt: Date.now() - window.__hsT0, type: 'SEEK6' }), true)`);
await seek(host, project, 6); await sleep(4000);
for (const e of await evalOn(host, 'window.__hs')) console.log(JSON.stringify(e));
process.exit(0);
