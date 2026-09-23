// ライブラリのホームの構成を DOM から採る（ラッパー作成の検証スクリプト）: node home.mjs <out.json>
// セクション見出し・並び・各カテゴリの status（soon / 件数）・矩形（3 列 × 3 行の判定用）・詳細の開閉を記録する。
import { connect, evalOn, sleep } from './common.mjs';
import { saveJson } from './l1-lib.mjs';
const cdp = await connect();
await sleep(300);
const home = await evalOn(cdp, `(()=>{
 const root=document.querySelector('[data-akari-library-home]');
 if(!root)return{home:false};
 const rect=e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
 const leafTexts=e=>[...e.querySelectorAll('span,div,small')].filter(n=>n.children.length===0).map(n=>n.textContent.trim()).filter(Boolean);
 const cats=[...root.querySelectorAll('[data-akari-library-category]')].map(e=>{
   const sec=e.closest('section');const head=sec?[...sec.children].find(c=>!c.querySelector('[data-akari-library-category]'))?.textContent.trim()??null:null;
   return{key:e.getAttribute('data-akari-library-category'),section:head,
     primary:e.closest('[data-akari-library-primary-tiles]')?true:false,
     inDetails:e.closest('[data-akari-library-details]')?true:false,
     attrs:Object.fromEntries([...e.attributes].filter(a=>a.name.startsWith('data-')||a.name==='disabled'||a.name==='draggable'||a.name==='title').map(a=>[a.name,a.value])),
     texts:leafTexts(e),rect:rect(e)}});
 const sections=[...root.querySelectorAll('section')].map(s=>({head:[...s.children].find(c=>!c.querySelector('[data-akari-library-category]'))?.textContent.trim()??null,count:s.querySelectorAll('[data-akari-library-category]').length}));
 const details=[...root.querySelectorAll('[data-akari-library-details], [data-akari-library-details-toggle]')].map(e=>({tag:e.tagName,attrs:Object.fromEntries([...e.attributes].filter(a=>a.name.startsWith('data-')||a.name.startsWith('aria-')).map(a=>[a.name,a.value])),text:e.children.length===0?e.textContent.trim():leafTexts(e).slice(0,3)}));
 const primary=root.querySelector('[data-akari-library-primary-tiles]');
 let grid=null;
 if(primary){const tiles=[...primary.querySelectorAll('[data-akari-library-primary-tile]')];const xs=[...new Set(tiles.map(t=>Math.round(t.getBoundingClientRect().left)))].sort((a,b)=>a-b);const ys=[...new Set(tiles.map(t=>Math.round(t.getBoundingClientRect().top)))].sort((a,b)=>a-b);
   grid={count:tiles.length,columns:xs.length,rows:ys.length,order:tiles.map(t=>t.getAttribute('data-akari-library-primary-tile')),kinds:tiles.map(t=>t.getAttribute('data-akari-library-tile-kind')),categoryAttr:tiles.map(t=>t.getAttribute('data-akari-library-category')),soon:tiles.map(t=>t.getAttribute('data-akari-library-soon')),texts:tiles.map(t=>[...t.querySelectorAll('span')].map(x=>x.textContent.trim())),draggable:tiles.map(t=>t.getAttribute('draggable')),gridTemplateColumns:getComputedStyle(primary).gridTemplateColumns,
     cells:tiles.map(t=>{const r=t.getBoundingClientRect();return{key:t.getAttribute('data-akari-library-primary-tile'),col:xs.indexOf(Math.round(r.left)),row:ys.indexOf(Math.round(r.top)),borderLeft:getComputedStyle(t).borderLeftWidth+' '+getComputedStyle(t).borderLeftStyle,borderRight:getComputedStyle(t).borderRightWidth+' '+getComputedStyle(t).borderRightStyle,boxShadow:getComputedStyle(t).boxShadow}})};}
 return{home:true,homeRect:rect(root),sections,categoryOrder:cats.map(c=>c.key),categories:cats,details,grid,
   duplicates:cats.map(c=>c.key).filter((k,i,a)=>a.indexOf(k)!==i)};
})()`);
await saveJson(process.argv[2], home);
console.log(JSON.stringify({ sections: home.sections, order: home.categoryOrder, grid: home.grid && { count: home.grid.count, columns: home.grid.columns, rows: home.grid.rows, order: home.grid.order }, details: home.details }));
cdp.close(); process.exit(0);
