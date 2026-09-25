// プレビューの字幕プレートの中心（出力 px）: node plates2.mjs <outW> <outH>
import { view } from './l1-common.mjs';
const [W, H] = process.argv.slice(2).map(Number);
const v = await view(Number(process.env.CDP_PORT || 9558));
console.log(JSON.stringify(await v.eval(`(()=>{const s=document.getElementById('preview-stage').getBoundingClientRect();return [...document.querySelectorAll('.caption-row-plate')].filter(p=>p.getBoundingClientRect().width>0).map(p=>{const l=p.querySelector('.akari-caption__line')||p;const r=l.getBoundingClientRect();const pr=p.getBoundingClientRect();return{id:p.id,text:(l.textContent||'').trim().slice(0,16),center:{x:+((r.x+r.width/2-s.x)/s.width*${W}).toFixed(1),y:+((r.y+r.height/2-s.y)/s.height*${H}).toFixed(1)},plateBg:getComputedStyle(p).backgroundColor,color:getComputedStyle(l).color}})})()`)));
process.exit(0);
