// 置いた文字の「文字」行 L1 の共通部品（ラッパー作成の検証スクリプト）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { S, command, sleep, waitEval } from './l1-lib.mjs';

export const captionsOf = async project => { const p = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')); return Array.isArray(p) ? p : p.captions; };
export async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
export const shellCall = body => `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');const s=window.theia.container.get(k);${body};return true})()`;
export const NOTICES = `[...document.querySelectorAll('.theia-notification-toasts .theia-notification-list-item')].map(e=>e.textContent.trim())`;

// タイムラインの字幕チップ（話した言葉・置いた文字とも）の矩形と、行の見出し。
export const CHIPS = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return{id:e.dataset.akariItemId,lane:e.dataset.akariLane??null,left:px(r.left),top:px(r.top),width:px(r.width),height:px(r.height),text:(e.textContent||'').trim().slice(0,20),bg:cs.backgroundColor,border:cs.borderColor,cls:[...e.classList].filter(c=>c!=='akari-annotations-strip-caption').join(' ')}})})()`;
export const ROW_LABELS = `(()=>{const px=v=>Math.round(v*10)/10;const tl=document.querySelector('.akari-annotations')||document.body;return [...tl.querySelectorAll('*')].filter(e=>e.children.length===0&&/^(字幕|文字)$/.test((e.textContent||'').trim())).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent.trim(),cls:String(e.className).slice(0,80),top:px(r.top),height:px(r.height),visible:r.width>0&&r.height>0}}).filter(x=>x.visible)})()`;

export const overlaps = (a, b) => a.left < b.left + b.width - 0.5 && b.left < a.left + a.width - 0.5 && a.top < b.top + b.height - 0.5 && b.top < a.top + a.height - 0.5;

export async function openProject(session, project, seek, port) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `document.querySelectorAll('.akari-annotations-strip-caption').length>0`, { label: 'timeline caption chips', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek }));
        await sleep(3000);
        return (await listTargets(port)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2000);
}

export async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close();
        const target = await waitFor('webview target', async () => (await listTargets(port)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)), 120_000);
        cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
        const contexts = []; cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
        await cdp.send('Runtime.enable');
        await waitFor('preview stage', async () => {
            for (const c of [undefined, ...contexts.map(c => c.id)]) { try { if (await evalOn(cdp, `Boolean(document.getElementById('preview-stage'))`, c)) { ctx = c; return true; } } catch {} }
            return false;
        }, 120_000);
    };
    await attach();
    return {
        get cdp() { return cdp; },
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
export const PLATES = `[...document.querySelectorAll('.caption-row-plate')].map(p=>{const l=p.querySelector('.akari-caption__line')||p;const r=l.getBoundingClientRect();return{id:p.id,text:(l.textContent||'').trim(),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)}})`;
export { S };
