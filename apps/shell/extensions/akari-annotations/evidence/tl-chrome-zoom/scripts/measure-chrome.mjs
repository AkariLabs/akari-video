#!/usr/bin/env node
// BEFORE / AFTER の縦方向の内訳を同じウィンドウサイズ（CSS 1440×900）で採る（ラッパー作成の検証スクリプト）。
// 使い方: node measure-chrome.mjs <apps/shell> <project> <isoDir> <out.json> [--port=9462] [--shot=<png>]
// 記録物（JSON・PNG）はリポの外へ書く。起動した Electron はこのスクリプトが自分の PID だけ止める。
import { writeFile } from 'node:fs/promises';
import { screenshot } from './cdp-lib.mjs';
import { CHROME, PORT_DEFAULT, evalOn, start, stop } from './l1-common.mjs';

const [shellDir, project, isoDir, out] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? PORT_DEFAULT);
const SHOT = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const session = await start({ shellDir, project, isoDir, port: PORT });
try {
    const chrome = await evalOn(session.cdp, CHROME);
    const mainTabBar = await evalOn(session.cdp, `(()=>{const b=document.querySelector('#theia-main-content-panel .lm-TabBar');const l=b?.querySelector('.lm-TabBar-tabLabel');return b?{height:Math.round(b.getBoundingClientRect().height*10)/10,fontSize:l?getComputedStyle(l).fontSize:null}:null})()`);
    const leftTabBar = await evalOn(session.cdp, `(()=>{const b=document.querySelector('#theia-left-content-panel .lm-TabBar, #theia-left-side-panel .lm-TabBar');return b?{height:Math.round(b.getBoundingClientRect().height*10)/10,width:Math.round(b.getBoundingClientRect().width*10)/10}:null})()`);
    const result = { pid: session.pid, chrome, mainTabBar, leftTabBar };
    await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
    if (SHOT) await screenshot(session.cdp, SHOT);
    console.log(JSON.stringify(result, null, 2));
} finally {
    await stop(session);
}
