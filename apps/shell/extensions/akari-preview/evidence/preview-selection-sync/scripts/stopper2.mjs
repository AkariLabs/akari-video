// pointerdown の各リスナー通過を記録: Event.prototype の stop 系と、window/document capture の先頭・末尾の番兵
import { clickOutput, hostCdp, installProbe, sleep, snapshot, viewCdp } from './pss.mjs';
const [x = '220', y = '420', pre = '1'] = process.argv.slice(2);
const host = await hostCdp(); const view = await viewCdp();
await view.eval(`(()=>{ window.__stops=[]; if (!Event.prototype.__pssWrapped) { for (const m of ['stopPropagation','stopImmediatePropagation','preventDefault']) { const o = Event.prototype[m]; Event.prototype[m] = function(...a){ if (/pointer|mouse|click/.test(this.type)) window.__stops.push({m, type: this.type, phase: this.eventPhase, cur: this.currentTarget?.id || this.currentTarget?.nodeName || String(this.currentTarget), stack: new Error().stack.split('\\n').slice(2,6).map(s=>s.trim().replace(/\\(http[^)]*index\\.html[^:]*:/,'(L:')).join(' | ')}); return o.apply(this,a); }; } Event.prototype.__pssWrapped = true;
 for (const [tgt,name] of [[window,'win'],[document,'doc'],[document.getElementById('preview-stage'),'stage']]) { tgt.addEventListener('pointerdown', e => window.__stops.push({m:'seen-cap', at:name, target: e.target.id||e.target.nodeName}), true); tgt.addEventListener('pointerdown', e => window.__stops.push({m:'seen-bub', at:name}), false); } } return true })()`);
if (pre === '1') { await clickOutput(host, view, 260, 190); await sleep(1000); }
await view.eval('(window.__stops=[], true)');
await clickOutput(host, view, Number(x), Number(y)); await sleep(1000);
for (const s of await view.eval('window.__stops')) console.log(JSON.stringify(s));
const s = await snapshot(host, view, 'after'); console.log('tl', JSON.stringify(s.timeline.selected));
host.close(); view.cdp.close(); process.exit(0);
