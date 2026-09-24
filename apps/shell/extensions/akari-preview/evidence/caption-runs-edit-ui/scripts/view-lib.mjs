// 出力プレビューの webview（入れ子 iframe の内側）への到達・座標の対応・よく使う操作（caption-drag-and-icon-tools の l1.mjs から抜き出し）。
import path from 'node:path';
import { CDP, evalOn, listTargets, realClick } from './cdp-lib.mjs';
import { S, command, sleep, waitEval } from './l1-lib.mjs';

export async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}

export async function view(port) {
    let cdp, ctx;
    const attach = async () => {
        cdp?.close(); cdp = undefined;
        await waitFor('preview stage', async () => {
            const targets = (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
            for (const target of targets) {
                const client = new CDP(target.webSocketDebuggerUrl);
                try { await client.connect(); } catch { continue; }
                const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
                try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
                await sleep(300);
                for (const c of [undefined, ...contexts.map(c => c.id)]) {
                    try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; return true; } } catch {}
                }
                client.close();
            }
            return false;
        }, 180_000);
    };
    await attach();
    return {
        get cdp() { return cdp; },
        close: () => cdp?.close(),
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch (error) { if (/eval failed/.test(error.message)) throw error; await attach(); return evalOn(cdp, expr, ctx); } }
    };
}

export async function calibrate(session, v) {
    await v.eval(`(()=>{if(!window.__runsHooked){window.__runsHooked=true;window.addEventListener('pointermove',e=>window.__runsPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__runsPointer=null');
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await session.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__runsPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy, iframe: frame };
}
export const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });

export async function mouse(cdp, type, pt, modifiers = 0, extra = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: type === 'mouseMoved' ? (extra.buttons ? 'left' : 'none') : 'left', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? (type === 'mouseMoved' ? 0 : 1), modifiers });
}
export async function clickLocal(session, off, pt, opts = {}) { const p = toPage(off, pt); await realClick(session.cdp, p.x, p.y, opts); }
/** webview ローカル座標でなぞる（押す → steps 刻みで動かす → 離す）。 */
export async function dragLocal(session, off, from, to, { steps = 12, modifiers = 0 } = {}) {
    const cdp = session.cdp;
    await mouse(cdp, 'mouseMoved', toPage(off, from), modifiers); await sleep(120);
    await mouse(cdp, 'mousePressed', toPage(off, from), modifiers, { buttons: 1 }); await sleep(120);
    for (let s = 1; s <= steps; s++) {
        const pt = { x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps };
        await mouse(cdp, 'mouseMoved', toPage(off, pt), modifiers, { buttons: 1 }); await sleep(35);
    }
    await sleep(80);
    await mouse(cdp, 'mouseReleased', toPage(off, to), modifiers, { buttons: 0 }); await sleep(200);
}

export const seek = (session, project, time) => evalOn(session.cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));

export const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden')return null;const block=p.querySelector('.akari-caption__block');const els=block?[block]:[...p.querySelectorAll('.akari-caption__line')];const rs=(els.length?els:[p]).map(e=>e.getBoundingClientRect());const r={left:Math.min(...rs.map(x=>x.left)),right:Math.max(...rs.map(x=>x.right)),top:Math.min(...rs.map(x=>x.top)),bottom:Math.max(...rs.map(x=>x.bottom))};if(!(r.right-r.left>0))return null;return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:(r.left+r.right)/2,cy:(r.top+r.bottom)/2,w:r.right-r.left,h:r.bottom-r.top,text:(block||p).textContent,selected:p.hasAttribute('data-selected')}})()`;

export async function openPreview(session, project, port, seekTo, firstId) {
    await evalOn(session.cdp, command('akari.annotations.open'));
    await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await seek(session, project, seekTo);
        await sleep(3000);
        return (await listTargets(port)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 120_000);
    await sleep(2500);
    const v = await view(port);
    await waitFor(`${firstId} plate`, async () => { await seek(session, project, seekTo); await sleep(1200); return v.eval(PLATE(firstId)); }, 120_000);
    return v;
}
