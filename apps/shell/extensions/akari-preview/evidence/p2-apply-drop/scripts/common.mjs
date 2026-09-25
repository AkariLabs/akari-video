// 本票 L1 の共通部品（ラッパー作成の検証スクリプト）。ポートは CDP_PORT（既定 9557）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep } from './cdp-lib.mjs';
export { evalOn, sleep };
export const S = v => JSON.stringify(v);
export const PORT = Number(process.env.CDP_PORT || 9557);
export async function connect() {
  const target = (await listTargets(PORT)).find(t => t.type === 'page');
  const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
  return cdp;
}
export const readCaptionsText = project => readFile(path.join(project, 'captions.json'), 'utf8');
export const readEditText = project => readFile(path.join(project, 'edit.json'), 'utf8');
export const captionRows = text => { const p = JSON.parse(text); return Array.isArray(p) ? p : p.captions; };
// タイムラインの秒 → 画面 x（話した言葉 c-0004 = 9〜11.5 秒のチップから換算）
export const TIME_X = `(()=>{const c=document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="c-0004"]');if(!c)return null;const r=c.getBoundingClientRect();const pps=r.width/2.5;return{x0:r.left-9*pps,pps}})()`;
// タイムラインの行（見出しの文言と縦の中心）
export const ROWS = `(()=>{const tl=document.querySelector('.akari-annotations')||document.body;return [...tl.querySelectorAll('*')].filter(e=>e.children.length===0&&/^(字幕|文字|Base|A1|V1|V2)(\\s|$)/.test((e.textContent||'').trim())).map(e=>{const r=e.getBoundingClientRect();return{text:e.textContent.trim().split(/\\s/)[0],cy:Math.round(r.top+r.height/2)}}).filter(x=>x.cy>0)})()`;
// ドラッグ中の見た目（落とせる場所のハイライト・ゴースト・フッター）
export const PROBE = `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'};
 const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
 const tl=document.querySelector('.akari-annotations');
 const marked=[...document.querySelectorAll('*')].filter(e=>vis(e)&&[...e.attributes].some(a=>/drop|ghost|highlight|insertion|drag-?over|accept/i.test(a.name)&&a.name.startsWith('data-')&&!/^data-akari-(os-file-drop-target|dropzone)$/.test(a.name))).slice(0,12).map(e=>({tag:e.tagName,attrs:[...e.attributes].filter(a=>a.name.startsWith('data-')).map(a=>a.name+'='+a.value.slice(0,40)),rect:rect(e),outline:getComputedStyle(e).outlineStyle+' '+getComputedStyle(e).outlineColor,bg:getComputedStyle(e).backgroundColor}));
 const outlined=[...document.querySelectorAll('div')].filter(e=>vis(e)&&(/249, 115, 22|241, 76, 76|dashed/.test(e.style.outline||'')||/dashed/.test(e.style.border||''))).slice(0,8).map(e=>({cls:String(e.className).slice(0,60),rect:rect(e),outline:e.style.outline,border:e.style.border,bg:e.style.background,rejected:e.classList.contains('akari-annotations-ghost-rejected')}));
 const scroll=document.querySelector('.akari-timeline-scroll');const sr=scroll?rect(scroll):null;
 const footer=[...document.querySelectorAll('.akari-annotations *')].filter(e=>e.children.length===0&&vis(e)&&/置け|落と|追加|文字/.test(e.textContent)&&e.textContent.length<80).map(e=>e.textContent.trim()).slice(-4);
 return{marked,outlined,timelineScroll:sr&&{...sr,scrollTop:scroll.scrollTop},footer}})()`;
export const CHIPS = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.akariItemId,lane:e.dataset.akariLane??null,left:px(r.left),top:px(r.top),width:px(r.width),text:(e.textContent||'').trim().slice(0,20),selected:e.classList.contains('selected')||e.getAttribute('aria-selected')==='true'||/selected/.test(e.className)}})})()`;
export const NOTICES = `[...document.querySelectorAll('.theia-notification-toasts .theia-notification-list-item, .theia-notification-message')].map(e=>e.textContent.trim()).filter(Boolean).slice(-4)`;
export const PLAYHEAD = `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d\\s*\\/\\s*\\d+:\\d\\d$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())[0]||null`;
// 本票のカード（テキストスタイル）: grid / list どちらでも data-akari-catalog-preset-item で探す
export const cardSelector = id => `[data-akari-catalog-preset-item=${S('textstyle/' + id)}], [data-akari-catalog-item=${S('textstyle/' + id)}]`;
export const CARDS = `(()=>{const cards=[...document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]')];const hintEl=document.querySelector('[data-akari-library-category-hint]');
 const header=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/ドラッグ|＋|追加|置く/.test(e.textContent)&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().left<500&&e.textContent.length<60).map(e=>e.textContent.trim());
 return{count:cards.length,cards:cards.map(c=>({id:c.getAttribute('data-akari-catalog-preset-item'),draggable:c.getAttribute('draggable'),add:c.querySelectorAll('[data-akari-catalog-action=add]').length,addLabel:c.querySelector('[data-akari-catalog-action=add]')?.getAttribute('aria-label')??c.querySelector('[data-akari-catalog-action=add]')?.getAttribute('title')??null,imgs:[...c.querySelectorAll('img')].map(i=>i.getAttribute('draggable')),thumbDraggableFalse:c.querySelectorAll('[draggable=false]').length,listRow:c.hasAttribute('data-akari-catalog-preset-list-row')})),header}})()`;
