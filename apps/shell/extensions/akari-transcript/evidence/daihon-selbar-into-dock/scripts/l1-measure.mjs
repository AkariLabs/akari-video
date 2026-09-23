// 選択バーとドックの位置関係を測る式（BEFORE / AFTER 共通）。
import { S } from './l1-lib.mjs';

export const ROW = id => `.akari-daihon-row[data-caption-id="${id}"]`;
export const DOCK = '.akari-daihon-dock';
const px = 'const px=v=>Math.round(v*100)/100;const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:px(r.top),bottom:px(r.bottom),left:px(r.left),right:px(r.right),height:px(r.height),width:px(r.width)}};';
// 文字の折れ = 要素の高さ / line-height（行数）
const lines = 'const lines=e=>{if(!e)return null;const cs=getComputedStyle(e);const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;const r=e.getBoundingClientRect();const pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);return Math.max(1,Math.round((r.height-pad)/lh))};';

export const LAYOUT = `(()=>{${px}${lines}const vis=e=>Boolean(e&&!e.hidden&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0);
 const w=document.querySelector('.akari-daihon-widget');const d=document.querySelector(${S(DOCK)});const bars=[...document.querySelectorAll('.akari-daihon-selbar')];const sel=bars[0];
 const open=Boolean(d&&d.classList.contains('open')&&getComputedStyle(d).visibility!=='hidden'&&!d.hidden);
 const count=document.querySelector('.akari-daihon-selcount');const head=d?.querySelector('.akari-daihon-dock-head');
 const region=document.querySelector('.akari-daihon-rows-region');const footer=document.querySelector('.akari-daihon-footer');
 const dockBox=box(d);const selBox=vis(sel)?box(sel):null;
 // ドックの下端からフッターの上端までにある帯（選択バーなど）
 const between=[...(w?.children||[])].filter(c=>vis(c)&&c!==region&&c!==footer&&dockBox&&c.getBoundingClientRect().top>=dockBox.bottom-1&&c.getBoundingClientRect().bottom<=(footer?footer.getBoundingClientRect().top:Infinity)+1).map(c=>({className:String(c.className),box:box(c)}));
 return{widget:box(w),region:box(region),footer:box(footer),rows:box(document.querySelector('.akari-daihon-rows')),
  dock:{open,box:dockBox,title:(d?.querySelector('.akari-daihon-dock-title')?.textContent||'').trim(),
   head:head?{box:box(head),text:(head.textContent||'').trim(),lines:lines(head),children:[...head.children].map(c=>({className:String(c.className),text:(c.textContent||'').trim(),box:box(c),lines:lines(c),whiteSpace:getComputedStyle(c).whiteSpace,color:getComputedStyle(c).color,fontSize:getComputedStyle(c).fontSize}))}:null,
   tabs:[...(d?.querySelectorAll('[data-dock-tab]')||[])].map(t=>({tab:t.dataset.dockTab,label:(t.textContent||'').trim(),active:t.classList.contains('active')}))},
  selbar:{count:bars.length,visibleCount:bars.filter(vis).length,box:selBox,
   countText:(count?.textContent||'').trim()||null,countBox:vis(count)?box(count):null,countLines:vis(count)?lines(count):null,
   buttons:vis(sel)?[...sel.querySelectorAll('button')].map(b=>({text:(b.textContent||'').trim(),className:String(b.className),disabled:b.disabled,box:box(b),lines:lines(b)})):[]},
  relation:{dockBottom:dockBox?.bottom??null,selbarTop:selBox?.top??null,selbarBottom:selBox?.bottom??null,footerTop:box(footer)?.top??null,
   bandBelowDockPx:selBox&&dockBox?px(selBox.bottom-dockBox.bottom):0,bandsBetweenDockAndFooter:between},
  selected:[...document.querySelectorAll('.akari-daihon-row.selected')].map(r=>r.dataset.captionId)}})()`;

export const MENU = `(()=>{const m=[...document.querySelectorAll('.akari-daihon-pop')].filter(p=>p.getBoundingClientRect().height>0);return m.map(p=>({className:String(p.className),items:[...p.querySelectorAll('button')].map(b=>({text:(b.textContent||'').trim(),action:b.dataset.rowAction??null,disabled:b.disabled,title:b.title||null}))}))})()`;
