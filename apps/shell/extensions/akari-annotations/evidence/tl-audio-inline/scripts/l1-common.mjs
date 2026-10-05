// 音声クリップの直接編集 L1 の共通部品（ラッパー作成の検証スクリプト）。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { S, command, sleep, waitEval } from './l1-lib.mjs';

export const PORT = Number(process.env.CDP_PORT || 9463);
export const editText = project => readFileSync(path.join(project, 'edit.json'), 'utf8');
export const editJson = project => JSON.parse(editText(project));
export const editSha = project => createHash('sha256').update(readFileSync(path.join(project, 'edit.json'))).digest('hex');
export const audioItem = (project, id) => editJson(project).tracks.flatMap(t => t.items ?? []).find(i => i.id === id);

export async function attach(port = PORT) {
    const target = (await listTargets(port)).find(t => t.type === 'page');
    const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
    return cdp;
}

// タイムライン（起動時に自動で開く）を待ち、ダイアログ・通知を閉じ、タイムラインを最大化して音声クリップ 3 本が出るまで待つ。
const SHELL = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');return window.theia.container.get(k)})()`;
export async function openTimeline(cdp) {
    await waitEval(cdp, `document.querySelectorAll('[data-akari-item-kind="audio"][data-akari-item-id]').length>=3`, { label: 'audio clips', timeoutMs: 120_000 });
    await sleep(1500);
    await evalOn(cdp, `(()=>{for(const b of document.querySelectorAll('.dialogOverlay button, .theia-notification-list-item button')){const t=b.textContent.trim();if(t==='キャンセル'||t==='開くだけ')b.click()}return true})()`);
    await sleep(800);
    await evalOn(cdp, `(()=>{const s=${SHELL};const w=s.widgets.find(w=>w.node.querySelector('.akari-annotations-widget')||w.node.classList.contains('akari-annotations-widget'));if(!w)return false;s.activateWidget(w.id);if(!w.node.closest('.theia-maximized'))s.toggleMaximized(w);return true})()`);
    await sleep(2500);
}

const px = 'v=>Math.round(v*10)/10';
// 音声クリップの矩形と、その中の印・丸・線・点・曲線（data 属性で拾う）。
export const CLIP = id => `(()=>{const px=${px};const e=document.querySelector('[data-akari-item-kind="audio"][data-akari-item-id=${S(id)}]');if(!e)return null;const r=e.getBoundingClientRect();const rect=x=>{const b=x.getBoundingClientRect();return{left:px(b.left),top:px(b.top),w:px(b.width),h:px(b.height),cx:px(b.left+b.width/2),cy:px(b.top+b.height/2)}};const pick=sel=>[...e.querySelectorAll(sel)].map(x=>({...rect(x),attrs:Object.fromEntries(Object.entries(x.dataset))}));return{id:${S(id)},left:px(r.left),top:px(r.top),w:px(r.width),h:px(r.height),kfMarkers:pick('[data-akari-audio-keyframe-marker]'),fadeHandles:pick('[data-akari-audio-fade-handle]'),gainLine:pick('[data-akari-audio-gain-line]'),kfPoints:pick('[data-akari-audio-kf-index]'),fadeCurves:pick('[data-akari-audio-fade-curve]'),waveform:pick('.akari-annotations-strip-audio-waveform').length,childCount:e.children.length}})()`;
export const READOUT = `(()=>{const e=document.querySelector('[data-akari-audio-inline-readout]');if(!e)return null;const r=e.getBoundingClientRect();return{text:e.textContent.trim(),visible:r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'}})()`;
export const MENU = `[...document.querySelectorAll('[data-akari-fade-shape]')].filter(e=>!e.closest('[data-akari-item-kind]')).map(e=>{const r=e.getBoundingClientRect();return{shape:e.dataset.akariFadeShape,text:e.textContent.trim(),checked:e.getAttribute('aria-checked')??e.dataset.checked??null,cx:r.left+r.width/2,cy:r.top+r.height/2,visible:r.width>0&&r.height>0}})`;
export const HEADERS = `[...document.querySelectorAll('.akari-track-header-row')].map(e=>{const r=e.getBoundingClientRect();return{trackId:e.dataset.akariTimelineTrackId,top:Math.round(r.top*10)/10,h:Math.round(r.height*10)/10}})`;
export const RESIZE_HANDLES = `[...document.querySelectorAll('.akari-track-header-resize-handle')].map(e=>{const r=e.getBoundingClientRect();const row=e.closest('.akari-track-header-row');return{trackId:row?.dataset.akariTimelineTrackId??null,x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})`;
export const DIALOG = `(()=>{const d=document.querySelector('.dialogOverlay .dialogBlock, .p-Widget.dialogOverlay');if(!d)return null;return{text:(d.textContent||'').trim().slice(0,200),selects:[...d.querySelectorAll('select')].map(s=>({name:s.name||s.dataset.akariFadeShapeSelect||s.getAttribute('aria-label')||'',value:s.value,options:[...s.options].map(o=>o.value)}))}})()`;

export async function key(cdp, k) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
export const UNDO = { modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, commands: ['undo'] };
export const DELETE = { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 };
export async function waitChange(project, before, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { if (editText(project) !== before) { await sleep(600); return true; } await sleep(150); }
    return false;
}
export { S, command, sleep, waitEval, evalOn };
