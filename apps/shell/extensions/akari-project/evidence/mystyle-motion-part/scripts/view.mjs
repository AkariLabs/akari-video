// 出力プレビュー（webview の入れ子 iframe の内側）への到達と、webview 座標 → 本体ページ座標の換算
// （akari-preview/evidence/caption-drag-and-icon-tools/scripts/l1.mjs の view / calibrate の写し）。
import { CDP, evalOn, listTargets, sleep } from './cdp-lib.mjs';
import { waitFor } from './l1-common.mjs';

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
        close() { cdp?.close(); },
        eval: async expr => { try { return await evalOn(cdp, expr, ctx); } catch { await attach(); return evalOn(cdp, expr, ctx); } }
    };
}
export async function calibrate(page, v) {
    await v.eval(`(()=>{if(!window.__mslHooked){window.__mslHooked=true;window.addEventListener('pointermove',e=>window.__mslPointer={x:e.clientX,y:e.clientY},true)}return true})()`);
    const frame = await evalOn(page, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top,width:r.width,height:r.height}})()`);
    const probe = async (x, y) => {
        await v.eval('window.__mslPointer=null');
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 3, y: y - 3, button: 'none' }); await sleep(80);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(250);
        return waitFor('pointer', () => v.eval('window.__mslPointer'));
    };
    const a = { x: Math.round(frame.left + frame.width * 0.3), y: Math.round(frame.top + frame.height * 0.3) };
    const b = { x: Math.round(frame.left + frame.width * 0.7), y: Math.round(frame.top + frame.height * 0.6) };
    const la = await probe(a.x, a.y), lb = await probe(b.x, b.y);
    const sx = (b.x - a.x) / (lb.x - la.x), sy = (b.y - a.y) / (lb.y - la.y);
    return { sx, sy, dx: a.x - la.x * sx, dy: a.y - la.y * sy };
}
export const toPage = (off, pt) => ({ x: pt.x * off.sx + off.dx, y: pt.y * off.sy + off.dy });
// 字幕のプレートの中心（webview 座標）
export const PLATE_CENTER = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${JSON.stringify(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const cs=getComputedStyle(p);if(cs.display==='none'||cs.visibility==='hidden')return null;const l=p.querySelector('.akari-caption__block')||p.querySelector('.akari-caption__line')||p;const r=l.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
// ミニパネル（字幕の選択ツール）の中身
export const TOOLS = `(()=>{const vis=e=>{const b=e.getBoundingClientRect();const cs=getComputedStyle(e);return b.width>0&&b.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'};const t=document.querySelector('.akari-caption-select-tools');if(!t||!vis(t))return null;const r=t.getBoundingClientRect();return{rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},items:[...t.querySelectorAll('button, [role="button"]')].filter(vis).map(b=>({text:(b.textContent||'').trim(),title:b.getAttribute('title'),aria:b.getAttribute('aria-label'),data:[...b.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value.slice(0,40)),hasSvg:!!b.querySelector('svg')}))}})()`;
