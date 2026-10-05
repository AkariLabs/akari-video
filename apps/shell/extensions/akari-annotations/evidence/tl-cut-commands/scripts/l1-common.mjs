// タイムラインの縦幅・ズームバー L1 の共通部品（ラッパー作成の検証スクリプト）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { S, command, launch, sleep, stop, waitEval } from './l1-lib.mjs';

export { S, command, evalOn, sleep, stop, waitEval };
export const PORT_DEFAULT = 9465;
export const editOf = async project => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));

export async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

/** Electron を起動してタイムラインを開く。shellDir = apps/shell。 */
export async function start({ shellDir, project, isoDir, port, keepState = false }) {
    const repository = path.resolve(shellDir, '../..');
    if (port !== PORT_DEFAULT || ![project, isoDir].every(value => value && path.isAbsolute(value)
        && value.includes('tl-cut-commands') && path.relative(repository, value).startsWith('..'))) {
        throw new Error('Use port 9465 and dedicated directories outside the repository.');
    }
    const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
    const session = await launch({ shellDir, electron, project, port, isoDir, keepState });
    // タイムラインは edit.json のあるフォルダなら起動時に下側パネルへ出る。出ていないときだけ開く（開くコマンドは
    // 作成ダイアログを出すことがあるので待たない）。
    const present = await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`, { label: 'timeline caption chips', timeoutMs: 30_000 }).catch(() => false);
    if (!present) {
        await session.cdp.send('Runtime.evaluate', { expression: command('akari.annotations.open'), awaitPromise: false });
        await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`, { label: 'timeline caption chips', timeoutMs: 120_000 });
    }
    await sleep(1500);
    await tidy(session.cdp);
    await sleep(1500);
    return session;
}

/** 作成ダイアログ・通知を閉じ、左右のパネルを畳んでタイムラインを横に広げる（BEFORE / AFTER で同じ手順）。 */
export async function tidy(cdp) {
    await evalOn(cdp, `(()=>{
for(const b of document.querySelectorAll('.dialogOverlay button.secondary'))b.click();
for(const b of document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-toasts .codicon-close, .akari-guide-announcement button.close'))b.click();
const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');
const s=window.theia.container.get(k);s.collapsePanel('right');s.collapsePanel('left');return true})()`);
}

export const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;

// タイムラインの入ったパネルの縦方向の内訳（タブ行・ツールバー・横バー・足元行・トラックの見えている領域）。
export const CHROME = `(()=>{
const px=v=>Math.round(v*10)/10;
const w=document.getElementById('akari-annotations-widget');
if(!w)return null;
const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();const cs=getComputedStyle(e);const mt=parseFloat(cs.marginTop)||0,mb=parseFloat(cs.marginBottom)||0;return{top:px(r.top),height:px(r.height),marginTop:mt,marginBottom:mb,outer:px(r.height+mt+mb),display:cs.display,minHeight:cs.minHeight}};
const tab=document.getElementById('shell-tab-akari-annotations-widget');
const bar=tab?.closest('.lm-TabBar');
const label=tab?.querySelector('.lm-TabBar-tabLabel');
const kids=[...w.children].filter(e=>e.tagName!=='STYLE').map(e=>({tag:e.tagName,cls:String(e.className).slice(0,80),testid:e.getAttribute('data-testid'),text:(e.textContent||'').trim().slice(0,40),...box(e)}));
const strip=w.querySelector('.akari-timeline-scroll');
const hbar=w.querySelector('.akari-timeline-zoom-bar--h')||w.querySelector('[data-testid="akari-timeline-hscrollbar-track"]');
const vbar=w.querySelector('.akari-timeline-zoom-bar--v');
const toolbar=[...w.children].find(e=>e.tagName!=='STYLE');
const footer=[...w.children].filter(e=>e.tagName!=='STYLE').at(-1);
const sb=document.getElementById('theia-statusBar');
return{
 window:{w:innerWidth,h:innerHeight},
 widget:box(w),
 tabBar:bar?{height:px(bar.getBoundingClientRect().height),tabHeight:px(tab.getBoundingClientRect().height),fontSize:getComputedStyle(label||tab).fontSize,inBottom:Boolean(tab.closest('#theia-bottom-content-panel'))}:null,
 toolbar:box(toolbar),
 hbar:box(hbar),
 lastChild:footer?{...box(footer),text:(footer.textContent||'').trim().slice(0,60)}:null,
 statusMessage:(()=>{const e=document.getElementById('akari-timeline-message');return e?{text:(e.textContent||'').trim(),color:getComputedStyle(e).color}:null})(),
 vbar:vbar?{...box(vbar),width:px(vbar.getBoundingClientRect().width)}:null,
 stripScroll:strip?{clientHeight:strip.clientHeight,height:px(strip.getBoundingClientRect().height),offsetWidth:strip.offsetWidth,clientWidth:strip.clientWidth}:null,
 statusBar:sb?{height:px(sb.getBoundingClientRect().height)}:null,
 gridTemplateRows:getComputedStyle(w).gridTemplateRows,
 children:kids
}})()`;
