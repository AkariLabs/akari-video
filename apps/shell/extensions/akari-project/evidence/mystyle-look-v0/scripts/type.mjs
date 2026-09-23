// 要素をクリックして全選択 → 文字を入力（実キー / insertText）: node type.mjs '<selector>' '<text>'
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const [selector, text] = process.argv.slice(2);
const cdp = await connect();
const p = await evalOn(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
if (!p) { console.log('not found'); process.exit(1); }
await realClick(cdp, p[0], p[1]); await sleep(150);
const k = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 };
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, commands: ['selectAll'] }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
await cdp.send('Input.insertText', { text }); await sleep(150);
console.log(JSON.stringify(await evalOn(cdp, `document.querySelector(${JSON.stringify(selector)}).value`)));
cdp.close(); process.exit(0);
