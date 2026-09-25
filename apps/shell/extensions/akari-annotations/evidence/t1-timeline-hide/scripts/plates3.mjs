// 置いた文字（caption-key 指定）の板と文字の矩形を出力 px で: node plates3.mjs <key> [outW] [outH]
import { view } from './l1-common.mjs';
const [key, W = 1280, H = 720] = process.argv.slice(2);
const v = await view(Number(process.env.CDP_PORT || 9562));
console.log(JSON.stringify(await v.eval(`(()=>{const s=document.getElementById('preview-stage').getBoundingClientRect();const p=document.querySelector('.caption-row-plate[data-caption-key=${JSON.stringify(key)}]');if(!p)return null;const f=p.querySelector('.akari-caption__plate')||p;const l=p.querySelector('.akari-caption__line')||p;const o=r=>({left:+((r.left-s.left)/s.width*${W}).toFixed(1),top:+((r.top-s.top)/s.height*${H}).toFixed(1),width:+(r.width/s.width*${W}).toFixed(1),height:+(r.height/s.height*${H}).toFixed(1),cx:+((r.left+r.width/2-s.left)/s.width*${W}).toFixed(1),cy:+((r.top+r.height/2-s.top)/s.height*${H}).toFixed(1)});return{plate:o(f.getBoundingClientRect()),line:o(l.getBoundingClientRect()),fontFamily:getComputedStyle(l).fontFamily,bg:getComputedStyle(f).backgroundColor,opacity:getComputedStyle(p).opacity}})()`)));
process.exit(0);
