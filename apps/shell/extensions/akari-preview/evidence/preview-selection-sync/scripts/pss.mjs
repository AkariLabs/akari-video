// preview-selection-sync L1 の共通部品（ラッパー作成の検証スクリプト）。CDP_PORT=9624。
// - host: 本体ページ / view: 出力プレビューの webview（内側文書の main world）
// - 選択状態: webview の closure 変数（selectedCaptionId / requestedOverlayId / requestedCutId / selectedLayerId / cutSelected）を
//   Debugger の条件付きブレークポイント（常に false を返す logpoint）で window.__pssState へ写して読む
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, realClick, realDragMod, sleep } from './cdp-lib.mjs';
import { command } from './l1-lib.mjs';

export const PORT = Number(process.env.CDP_PORT || 9624);
export { sleep };
const S = JSON.stringify;

export async function hostCdp() {
    const target = (await listTargets(PORT)).find(t => t.type === 'page');
    const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    return cdp;
}

export async function viewCdp() {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        // 出力プレビューのタブが背面（ホームが前面）だと webview が無い → タブを前面へ
        try {
            const page = (await listTargets(PORT)).find(t => t.type === 'page');
            const h = new CDP(page.webSocketDebuggerUrl); await h.connect();
            const p = await evalOn(h, `(()=>{const t=[...document.querySelectorAll('.lm-TabBar-tab')].find(n=>n.textContent?.trim()==='出力プレビュー');if(!t||t.classList.contains('lm-mod-current'))return null;const r=t.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`).catch(() => null);
            if (p) { await realClick(h, p.x, p.y); await sleep(1500); }
            h.close();
        } catch {}
        const target = (await listTargets(PORT)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
        if (target) {
            const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
            const contexts = []; cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
            await cdp.send('Runtime.enable');
            await sleep(300);
            for (const c of contexts) {
                if (!c.auxData?.isDefault) continue;
                try {
                    if (await evalOn(cdp, `Boolean(document.getElementById('preview-stage') && window.akari)`, c.id)) {
                        const view = { cdp, ctx: c.id, frameId: c.auxData.frameId, reloads: 0 };
                        // webview は書き込み後に作り直されることがある（z-group で実測）。context が消えたら取り直して probe を入れ直す
                        view.eval = async expr => {
                            try { return await evalOn(view.cdp, expr, view.ctx); } catch (error) {
                                if (!/Cannot find context|context.*destroyed|Session|closed|timed out/i.test(String(error?.message))) throw error;
                                await sleep(2500);
                                const next = await viewCdp();
                                try { view.cdp.close(); } catch {}
                                Object.assign(view, { cdp: next.cdp, ctx: next.ctx, frameId: next.frameId, reloads: view.reloads + 1 });
                                if (view.probed) await installProbe(view);
                                return evalOn(view.cdp, expr, view.ctx);
                            }
                        };
                        return view;
                    }
                } catch {}
            }
            cdp.close();
        }
        await sleep(500);
    }
    throw new Error('preview webview main world not found');
}

// closure 変数を window.__pssState へ写す logpoint（applyRequestedOverlaySelection の先頭 = 毎 tick 呼ばれる）
export async function installProbe(view) {
    view.probed = true;
    const scripts = [];
    view.cdp.on('Debugger.scriptParsed', p => scripts.push(p));
    await view.cdp.send('Debugger.enable');
    await sleep(800);
    const markers = ['const applyRequestedOverlaySelection = () => {', 'const trackSelectionReleasePointer = event => {'];
    for (const s of scripts) {
        let src;
        try { src = (await view.cdp.send('Debugger.getScriptSource', { scriptId: s.scriptId })).scriptSource; } catch { continue; }
        if (src.indexOf(markers[0]) < 0) continue;
        const lineOf = m => src.slice(0, src.indexOf(m)).split('\n').length; // 0-based line after the marker line
        const condition = `(window.__pssState = { at: Date.now(), selectedCaptionId: typeof selectedCaptionId === 'undefined' ? '?' : selectedCaptionId,
            requestedOverlayId: typeof requestedOverlayId === 'undefined' ? 'undefined' : requestedOverlayId,
            requestedCutId: typeof requestedCutId === 'undefined' ? 'undefined' : requestedCutId,
            selectedLayerId: typeof selectedLayerId === 'undefined' ? '?' : selectedLayerId,
            cutSelected: typeof cutSelected === 'undefined' ? '?' : cutSelected,
            outputTime: typeof outputTime === 'undefined' ? '?' : outputTime }, false)`;
        const r = [];
        for (const m of markers) r.push(await view.cdp.send('Debugger.setBreakpoint', { location: { scriptId: s.scriptId, lineNumber: lineOf(m), columnNumber: 0 }, condition }));
        await view.eval(`(() => {
            window.__pssLog = [];
            const push = (kind, detail) => { window.__pssLog.push({ t: Date.now(), kind, detail }); if (window.__pssLog.length > 400) window.__pssLog.shift(); };
            window.__pssPush = push;
            for (const name of ['reportCaptionSelection', 'reportCutSelection', 'reportLayerSelection', 'reportOverlaySelection', 'reportPhotoClick']) {
                const fn = window.akari[name];
                if (typeof fn !== 'function' || fn.__pss) continue;
                const wrapped = function (...args) { push('out:' + name, JSON.parse(JSON.stringify(args ?? null) ?? 'null')); return fn.apply(this, args); };
                wrapped.__pss = true; window.akari[name] = wrapped;
            }
            window.addEventListener('message', event => {
                const d = event.data; if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
                if (/select|seek|focus|caption|overlay|layer|cut/i.test(d.type) && !/tick|progress|frame$/i.test(d.type)) {
                    const keep = {}; for (const k of Object.keys(d)) { const v = d[k]; if (v === null || ['string','number','boolean'].includes(typeof v)) keep[k] = v; else if (Array.isArray(v) && v.length < 20) keep[k] = v; }
                    push('in:' + d.type, keep);
                }
            }, true);
            return true;
        })()`);
        return { scriptId: s.scriptId, breakpoints: r };
    }
    throw new Error('webview script with applyRequestedOverlaySelection not found');
}

export const STATE = `(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 987654 }));
    const ix = window.akari.interaction;
    const vis = e => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none'; };
    const active = id => { const e = document.getElementById(id); return e ? { active: e.classList.contains('is-active') || (vis(e) && !e.hidden && getComputedStyle(e).display !== 'none'), cls: String(e.className) } : null; };
    return {
        closure: window.__pssState ?? null,
        stateAgeMs: window.__pssState ? Date.now() - window.__pssState.at : null,
        ix: ix ? { selectedId: ix.selectedId ?? null, selectedIds: ix.selectedIds, scopeId: ix.scopeId ?? null, kind: ix.selectionKind ?? null } : null,
        dom: {
            captionSelectBox: active('caption-select-box'),
            layerSelectBox: active('layer-select-box'),
            cutSelectBox: active('cut-select-box'),
            overlaySelected: [...document.querySelectorAll('[data-overlay-id][data-akari-interaction-selected="true"]')].map(e => e.getAttribute('data-overlay-id')),
            selectionFrames: [...document.querySelectorAll('[data-akari-interaction="selection-frame"]')].filter(vis).length
        },
        log: (window.__pssLog ?? []).slice(-30)
    };
})()`;

export const TIMELINE = `(() => ({
    selected: [...document.querySelectorAll('[data-akari-item-id]')].filter(e => /selected/.test(e.className)).map(e => e.dataset.akariItemId),
    playhead: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /^\\d+:\\d\\d(\\.\\d+)?\\s*\\/\\s*\\d+:\\d\\d/.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0).map(e => e.textContent.trim())
}))()`;

export async function snapshot(host, view, label) {
    const [state, timeline] = await Promise.all([view.eval(STATE), evalOn(host, TIMELINE)]);
    return { label, at: new Date().toISOString(), ...state, timeline };
}

export async function clearLog(view) { await view.eval(`(window.__pssLog = [], true)`); }

// 出力 px → 本体ページ CSS px
export async function stageHost(host, view) {
    const hostFrame = await evalOn(host, `(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>{const r=f.getBoundingClientRect();return r.width>100&&r.height>100&&/webview/.test(f.src||'')});const r=f.getBoundingClientRect();return{x:r.left,y:r.top}})()`);
    // 外側文書（webview/index.html）の中の content iframe の位置
    const outer = await (async () => {
        const target = (await listTargets(PORT)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
        const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
        const contexts = []; cdp.on('Runtime.executionContextCreated', p => contexts.push(p.context));
        await cdp.send('Runtime.enable'); await sleep(200);
        for (const c of contexts) {
            try { const v = await evalOn(cdp, `(()=>{if(document.getElementById('preview-stage'))return null;const f=document.querySelector('iframe#active-frame')||document.querySelector('iframe');if(!f)return null;const r=f.getBoundingClientRect();return{x:r.left,y:r.top}})()`, c.id); if (v) { cdp.close(); return v; } } catch {}
        }
        cdp.close(); return { x: 0, y: 0 };
    })();
    const inner = await view.eval(`(()=>{const s=document.getElementById('preview-stage');const r=s.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}})()`);
    return { x: hostFrame.x + outer.x + inner.x, y: hostFrame.y + outer.y + inner.y, w: inner.w, h: inner.h };
}
export const toHost = (geo, ox, oy, out = { width: 1280, height: 720 }) => ({ x: geo.x + ox / out.width * geo.w, y: geo.y + oy / out.height * geo.h });

export async function clickOutput(host, view, ox, oy, modifiers = 0) {
    const geo = await stageHost(host, view); const p = toHost(geo, ox, oy);
    await realClick(host, p.x, p.y, { modifiers }); await sleep(700); return p;
}
export async function dragOutput(host, view, from, to, modifiers = 0) {
    const geo = await stageHost(host, view); const a = toHost(geo, from[0], from[1]); const b = toHost(geo, to[0], to[1]);
    await realDragMod(host, [a, b], { modifiers, steps: 12 }); await sleep(900); return { a, b };
}
export async function seek(host, project, time) {
    await evalOn(host, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
    await sleep(1500);
}
export async function clickTimelineItem(host, id, modifiers = 0) {
    const sel = `[data-akari-item-id=${S(id)}]`;
    const p = await evalOn(host, `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+Math.min(24,r.width/2),y:r.top+r.height/2}})()`);
    if (!p) throw new Error(`timeline item ${id} not found`);
    await sleep(300);
    const q = await evalOn(host, `(()=>{const e=document.querySelector(${S(sel)});const r=e.getBoundingClientRect();return{x:r.left+Math.min(24,r.width/2),y:r.top+r.height/2}})()`);
    await realClick(host, q.x, q.y, { modifiers }); await sleep(1200); return q;
}
export async function shotStage(host, view, file) {
    const geo = await stageHost(host, view);
    const { data } = await host.send('Page.captureScreenshot', { format: 'png', clip: { x: geo.x, y: geo.y, width: geo.w, height: geo.h, scale: 1 } });
    await writeFile(file, Buffer.from(data, 'base64')); return file;
}
export async function shotWindow(host, file) {
    const { data } = await host.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(file, Buffer.from(data, 'base64')); return file;
}
export const Z = `(() => ({
    overlays: [...document.querySelectorAll('[data-overlay-id]')].map(e => ({ id: e.getAttribute('data-overlay-id'), z: e.style.zIndex, cz: getComputedStyle(e).zIndex, vis: getComputedStyle(e).visibility, parent: e.parentElement?.id || e.parentElement?.className?.toString().slice(0, 40) })),
    planes: [...document.querySelectorAll('canvas[data-akari-media-plane]')].map(e => ({ plane: e.getAttribute('data-akari-media-plane'), z: e.style.zIndex, cz: getComputedStyle(e).zIndex, parent: e.parentElement?.id || e.parentElement?.className?.toString().slice(0, 40), display: getComputedStyle(e).display })),
    layers: [...document.querySelectorAll('[data-akari-layer-id]')].map(e => ({ id: e.dataset.akariLayerId, tag: e.tagName, z: e.style.zIndex, vis: getComputedStyle(e).visibility, display: getComputedStyle(e).display }))
}))()`;
