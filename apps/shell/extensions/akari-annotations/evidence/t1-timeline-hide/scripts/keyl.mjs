// フォーカスを外して ⌘⇧L を 1 回（実キーイベント）: node keyl.mjs
import { connect, evalOn, sleep } from './common.mjs';
const cdp = await connect();
await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
const k = { key: 'L', code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 4 | 8 };
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
await sleep(2500); console.log(JSON.stringify({ keys: 'Cmd+Shift+L ×1' })); cdp.close(); process.exit(0);
