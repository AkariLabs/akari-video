// マイスタイル「動き」部品の L1 の共通部品（ラッパー作成の検証スクリプト。mystyle-look-v0/after.mjs の小道具を切り出し）。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { evalOn, realClick, realDrag, screenshot } from './cdp-lib.mjs';
import { sleep } from './l1-lib.mjs';

export const S = JSON.stringify;
export async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(200); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
export const center = async (cdp, selector, block = 'nearest') => waitFor(`${selector} visible`, () => evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:${S(block)}});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`));
export const clickSel = async (cdp, selector) => { const p = await center(cdp, selector); await realClick(cdp, p.x, p.y); await sleep(400); return p; };
export async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
export async function typeInto(cdp, selector, text) {
    await clickSel(cdp, selector);
    const k = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, commands: ['selectAll'] }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    await cdp.send('Input.insertText', { text }); await sleep(150);
}
export async function styleFiles(stylesDir) {
    let ids = [];
    try { ids = (await readdir(stylesDir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch {}
    const files = {};
    for (const id of ids) { try { files[id] = await readFile(path.join(stylesDir, id, 'style.json'), 'utf8'); } catch {} }
    return files;
}
export function deepKeys(value, acc = []) {
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { acc.push(k); deepKeys(v, acc); }
    return acc;
}
export const NOTICE = `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.getBoundingClientRect().width>0&&/マイスタイル|v0|当てません|当てました|未対応/.test(e.textContent)&&e.textContent.length<140&&!e.closest('[data-akari-my-style-shelf],[data-akari-my-style-dialog]')&&!(e.style.height==='26px'&&e.style.fontSize==='11px')).map(e=>e.textContent.trim())`;
export const SHELF = `(()=>{const s=document.querySelector('[data-akari-my-style-shelf]');if(!s)return null;const px=v=>Math.round(v*10)/10;const r=s.getBoundingClientRect();return{rect:{x:px(r.left),y:px(r.top),w:px(r.width),h:px(r.height)},cards:[...s.querySelectorAll('[data-akari-my-style-card]')].map(c=>{const cr=c.getBoundingClientRect();const btns=[...c.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);const tops=new Set(btns.map(b=>Math.round(b.getBoundingClientRect().top)));return{id:c.getAttribute('data-akari-my-style-card'),rect:{w:px(cr.width),h:px(cr.height)},draggable:c.getAttribute('draggable'),badge:c.querySelector('[data-akari-my-style-badge]')?.textContent?.trim()??null,parts:[...c.querySelectorAll('[data-akari-my-style-part]')].map(p=>({kind:p.getAttribute('data-akari-my-style-part'),label:p.textContent.trim()})),text:c.innerText.replace(/\\n+/g,' / ').slice(0,200),buttons:btns.map(b=>({aria:b.getAttribute('aria-label'),text:b.textContent.trim().slice(0,20),w:px(b.getBoundingClientRect().width),h:px(b.getBoundingClientRect().height)})),buttonRows:tops.size}})}})()`;
export async function openShelf(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
    const tab = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ライブラリ'&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top<80);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (tab) { await realClick(cdp, tab.x, tab.y); await sleep(1500); }
    const back = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (back) { await realClick(cdp, back.x, back.y); await sleep(800); }
    const det = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-library-details-toggle]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,expanded:b.getAttribute('aria-expanded')}})()`);
    if (det && det.expanded !== 'true') { await realClick(cdp, det.x, det.y); await sleep(800); }
    await clickSel(cdp, '[data-akari-library-category=textstyle]');
    await sleep(1500);
}
// 起動直後の通知（プロジェクトとして使うかの確認・置き場の移動のお知らせ）はタイムラインの上に重なるので閉じる（確認は「開くだけ」）。
export async function dismissToasts(cdp) {
    await sleep(1500);
    await evalOn(cdp, `(()=>{let n=0;for(const i of document.querySelectorAll('.theia-notification-list-item')){const b=[...i.querySelectorAll('button')].find(b=>b.textContent.trim()==='開くだけ');if(b){b.click();n++;continue}i.querySelector('.codicon-close')?.click();n++}return n})()`);
    await sleep(800);
}
export async function setupWindow(cdp) {
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).resize(360,'right');return true})()`);
    await sleep(800);
    await dismissToasts(cdp);
}
export async function widenTimeline(cdp) {
    const h = await evalOn(cdp, `(()=>{const h=[...document.querySelectorAll('.lm-SplitPanel-handle')].find(h=>h.parentElement.dataset.orientation==='vertical'&&h.getBoundingClientRect().width>300);if(!h)return null;const r=h.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    if (h && h.y > 320) { await realDrag(cdp, [h, { x: h.x, y: 300 }], { steps: 10 }); await sleep(1500); }
    await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-timeline-scroll');if(e){e.scrollTop=0;e.dispatchEvent(new Event('scroll'))}return true})()`);
    await sleep(600);
}
export const DIALOG = `(()=>{const d=document.querySelector('[data-akari-my-style-dialog]');if(!d)return null;return{text:d.innerText.replace(/\\n+/g,' / '),name:d.querySelector('[data-akari-my-style-name]')?.value,parts:[...d.querySelectorAll('[data-akari-my-style-part-input]')].map(i=>({kind:i.getAttribute('data-akari-my-style-part-input'),checked:i.checked,disabled:i.disabled,label:i.closest('label')?.textContent.replace(/\\s+/g,' ').trim()}))}})()`;
export async function shotTo(cdp, workDir, outFile) {
    const { execFileSync } = await import('node:child_process');
    await sleep(400);
    const raw = path.join(workDir, path.basename(outFile));
    await screenshot(cdp, raw);
    execFileSync('sips', ['-Z', '1440', raw, '--out', outFile], { stdio: 'ignore' });
}
