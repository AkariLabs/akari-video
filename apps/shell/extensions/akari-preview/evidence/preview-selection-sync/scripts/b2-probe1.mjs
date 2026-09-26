// b2 #1 の差分調査: 1 秒で出力の空き (1260,700) をクリック → タイムラインで shape-a を選ぶ。webview の報告・host からの選択・ホストの dispatch スタック
import { evalOn } from './cdp-lib.mjs';
import { clickOutput, clickTimelineItem, hostCdp, installProbe, seek, sleep, snapshot, viewCdp } from './pss.mjs';
const [project, item = 'shape-a', t = '1'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp(); await installProbe(view);
await seek(host, project, Number(t));
await clickOutput(host, view, 1260, 700); await sleep(800);
let s = await snapshot(host, view, 'blank'); console.log('after blank', JSON.stringify(s.timeline.selected), JSON.stringify({ cut: s.closure?.cutSelected, rcut: s.closure?.requestedCutId }));
await view.eval(`(()=>{ window.__pssLog = []; window.__t0 = Date.now(); return true })()`);
await evalOn(host, `(()=>{ window.__hs = []; window.__hsT0 = Date.now(); if (!window.__hsWrapped) { const o = window.dispatchEvent.bind(window); window.dispatchEvent = ev => { if (/primarySelected|timeline\\.layerSelected|timeline\\.overlaySelected|preview\\.layerSelected|preview\\.overlaySelected|preview\\.cutSelected|contextBar\\.userInput/.test(ev.type)) window.__hs.push({ dt: Date.now() - window.__hsT0, type: ev.type, detail: JSON.stringify(ev.detail).slice(0, 100), stack: new Error().stack.split('\\n').slice(2, 7).map(s => s.trim().replace(/\\(.*\\/([^/]+):(\\d+):\\d+\\)/, '($1:$2)').replace(/at file:.*bundle.js:(\\d+):\\d+/, 'anon:$1')).join(' < ') }); return o(ev); }; window.__hsWrapped = true; } return true })()`);
await clickTimelineItem(host, item); await sleep(1500);
for (const e of await evalOn(host, 'window.__hs')) console.log('H', JSON.stringify(e));
const t0 = await view.eval('window.__t0');
for (const l of await view.eval('window.__pssLog')) if (!/hover|set-selected-captions/.test(l.kind)) console.log('V', l.t - t0, l.kind, JSON.stringify(l.detail).slice(0, 100));
s = await snapshot(host, view, 'after'); console.log('final', JSON.stringify(s.timeline.selected), JSON.stringify(s.closure));
process.exit(0);
