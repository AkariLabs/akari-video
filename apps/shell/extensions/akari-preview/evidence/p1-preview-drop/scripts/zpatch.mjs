// 検証用の一時パッチ（実行中のアプリの DOM だけ）: ドロップ層の z-index を Theia の透明オーバーレイ（999）より上へ。ソースは触らない。
import { connect, evalOn } from './common.mjs';
const cdp = await connect();
console.log(await evalOn(cdp, `(()=>{if(window.__zpatch)return 'already';window.__zpatch=new MutationObserver(()=>{for(const l of document.querySelectorAll('[data-akari-preview-library-drop]'))if(l.style.zIndex!=='1000')l.style.zIndex='1000'});window.__zpatch.observe(document.body,{subtree:true,childList:true});return 'patched'})()`));
cdp.close(); process.exit(0);
