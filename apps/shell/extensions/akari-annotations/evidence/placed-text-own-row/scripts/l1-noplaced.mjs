#!/usr/bin/env node
// 置いた文字が 0 本の案件でタイムラインの見た目が変わらないかの比較（ラッパー作成の検証スクリプト）。
// 使い方: node l1-noplaced.mjs <repo> <project> <label> [--port=9451]
//   行の見出し・行ヘッダの矩形・字幕チップの矩形を results-noplaced-<label>.json へ書き、スクリーンショットを撮る。
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sanitize, saveJson, screenshot, sleep, stop } from './l1-lib.mjs';
import { evalOn } from './cdp-lib.mjs';
import { CHIPS, ROW_LABELS, openProject, shellCall } from './l1-common.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [repo, project, label] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9451);
const SHELL = path.join(repo, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const HEADERS = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('.akari-track-header-row')].map(e=>{const r=e.getBoundingClientRect();return{name:(e.querySelector('.akari-track-header-name')?.textContent||'').trim(),top:px(r.top),height:px(r.height)}}).filter(h=>h.height>0)})()`;
let session; const out = { label };
try {
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: path.join(os.tmpdir(), 'ptor-l1', `run-noplaced-${label}`) });
    await openProject(session, project, 4, PORT);
    await evalOn(session.cdp, shellCall(`s.collapsePanel('left')`));
    await sleep(2500);
    out.rowLabels = await evalOn(session.cdp, ROW_LABELS);
    out.headers = await evalOn(session.cdp, HEADERS);
    out.chips = (await evalOn(session.cdp, CHIPS)).map(({ id, lane, left, top, width, height, bg }) => ({ id, lane, left, top, width, height, bg }));
    await sleep(500);
    await screenshot(session.cdp, path.join(ROOT, `noplaced-${label}.png`));
} catch (e) { out.error = sanitize(e, repo); }
finally { await saveJson(path.join(ROOT, `results-noplaced-${label}.json`), out); await stop(session); }
console.log(JSON.stringify(out));
