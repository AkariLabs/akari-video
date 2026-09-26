// プレビューの再生位置の表示（「0:08 / 0:13」）を読む: node ptime.mjs
import { view } from './l1-common.mjs';
const v = await view(Number(process.env.CDP_PORT || 9627));
console.log(JSON.stringify(await v.eval(`[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/^\\d+:\\d\\d(\\.\\d+)?\\s*\\/\\s*\\d+:\\d\\d/.test((e.textContent||'').trim())).map(e=>e.textContent.trim())[0]||null`)));
process.exit(0);
