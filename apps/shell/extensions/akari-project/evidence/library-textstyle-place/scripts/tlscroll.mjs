// タイムラインの縦スクロールを指定位置へ: node tlscroll.mjs <scrollTop>
import { connect, evalOn } from './common.mjs';
const cdp = await connect();
console.log(await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-timeline-scroll');e.scrollTop=${Number(process.argv[2]||0)};e.dispatchEvent(new Event('scroll'));return e.scrollTop})()`)); cdp.close(); process.exit(0);
