// フォーカスを外して Cmd+Z を 1 回（実キーイベント）→ captions.json / edit.json が fixture の git HEAD と byte 一致か。
// 使い方: node undo.mjs <project> <out.json>
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { connect, evalOn, readCaptionsText, readEditText, sleep } from './common.mjs';
const [project, outFile] = process.argv.slice(2);
const head = f => execFileSync('/usr/bin/git', ['show', `HEAD:${f}`], { cwd: project, encoding: 'utf8' });
const cdp = await connect();
const before = { captionsEqualHead: (await readCaptionsText(project)) === head('captions.json'), editEqualHead: (await readEditText(project)) === head('edit.json') };
await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
const k = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 };
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
let after;
for (let i = 0; i < 20; i++) { await sleep(250); after = { captionsEqualHead: (await readCaptionsText(project)) === head('captions.json'), editEqualHead: (await readEditText(project)) === head('edit.json') }; if (after.captionsEqualHead && after.editEqualHead) break; }
await sleep(800);
after = { captionsEqualHead: (await readCaptionsText(project)) === head('captions.json'), editEqualHead: (await readEditText(project)) === head('edit.json') };
const gitDiff = execFileSync('/usr/bin/git', ['status', '--porcelain', '--', 'captions.json', 'edit.json'], { cwd: project, encoding: 'utf8' });
const rec = { at: new Date().toISOString(), keys: 'Cmd+Z ×1', before, after, gitStatusPorcelain: gitDiff };
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
