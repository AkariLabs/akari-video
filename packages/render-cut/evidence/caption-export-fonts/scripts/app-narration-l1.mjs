#!/usr/bin/env node
// caption-export-fonts の L1（アプリ実機）: 編集パネルのスタイルの見本カード「ナレーション字幕」（narration-caption）を撮り、
// そのカードを c-0001 に当てて captions.json の値とプレビューの computed font を記録する（書き出しは呼び出し側で CLI）。
// 使い方: node narration-l1.mjs <fixture 名> <出力ディレクトリ>
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WORK, start, stop, openProject, evalOn, screenshot, previewFrame, sleep, S, exec, realClick, waitEval } from './lib.mjs';
const [fixture, outDir] = process.argv.slice(2);
const PJ = path.join(WORK, 'ws-caption-export-fonts-narration');
execFileSync('/bin/sh', ['-c', `rm -rf "${PJ}" && mkdir -p "${PJ}" && (cd <work>/fx/${fixture} && git archive HEAD) | tar -x -C "${PJ}" && cd "${PJ}" && git init -q && git add -A && git -c user.email=l1@localhost -c user.name=l1 commit -qm fixture`]);
await mkdir(outDir, { recursive: true });
const rec = { fixture, project: PJ };
const session = await start(PJ);
const cdp = session.cdp;
const editUri = `file://${path.join(PJ, 'edit.json')}`;
const readCaptions = async () => JSON.parse(await readFile(path.join(PJ, 'captions.json'), 'utf8'));
const dismissToasts = () => evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
const rect = sel => waitEval(cdp, `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.x,y:r.y,w:r.width,h:r.height}:null})()`, { label: sel, timeoutMs: 20_000 });
try {
  await openProject(session, PJ, 0.5);
  await dismissToasts();
  const before = S(await readCaptions());
  let r = await rect('.akari-annotations-strip-caption'); await realClick(cdp, r.x + Math.min(r.w / 2, 10), r.y + r.h / 2); await sleep(1500);
  rec.opened = await evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return await window.theia.container.get(C).executeCommand('akari.captionPanel.toggle',{panel:'style'})})()`);
  const cardSel = '[data-akari-caption-panel="style"] [data-akari-style-card="narration-caption"]';
  await waitEval(cdp, `Boolean(document.querySelector(${S(cardSel)}))`, { label: 'narration card', timeoutMs: 30_000 });
  await sleep(2500);
  r = await rect(cardSel); await sleep(500); r = await rect(cardSel);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
  await writeFile(path.join(outDir, 'narration-sample-card.png'), Buffer.from(data, 'base64'));
  rec.cardFonts = await evalOn(cdp, `(async()=>{await document.fonts.ready;const c=document.querySelector(${S(cardSel)});return[...c.querySelectorAll('*')].filter(e=>e.childNodes.length&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>{const cs=getComputedStyle(e);return{text:e.textContent.slice(0,24),font:cs.fontFamily,weight:cs.fontWeight}}).slice(0,6)})()`);
  await dismissToasts();
  await realClick(cdp, r.x + Math.min(r.w / 2, 20), r.y + r.h / 2);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && S(await readCaptions()) === before) await sleep(250);
  await sleep(2500);
  rec.changed = S(await readCaptions()) !== before;
  rec.c0001 = (await readCaptions()).captions.find(c => c.id === 'c-0001');
  await evalOn(cdp, exec('akari.captionPanel.close'));
  await evalOn(cdp, exec('akari.preview.seekOutput', { editUri, time: 0.5 })); await sleep(2500);
  await screenshot(cdp, path.join(outDir, 'narration-applied.png'));
  const pf = await previewFrame();
  const ctxs = []; pf.on('Runtime.executionContextCreated', e => ctxs.push(e.context));
  await pf.send('Runtime.disable'); await pf.send('Runtime.enable'); await sleep(400);
  for (const c of ctxs) { try { const v = await evalOn(pf, `(async()=>{await document.fonts.ready;const l=[...document.querySelectorAll('.akari-caption__line')];return l.length?{lines:l.map(e=>{const cs=getComputedStyle(e);return cs.fontFamily+' '+cs.fontWeight}),faces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family)}:null})()`, c.id); if (v) rec.preview = v; } catch {} }
  rec.status = 'ok';
} catch (error) { rec.status = 'error'; rec.error = String(error?.stack || error); await screenshot(cdp, path.join(outDir, 'narration-error.png')).catch(() => {}); }
finally { await stop(session); await writeFile(path.join(outDir, 'narration-l1.json'), `${JSON.stringify(rec, null, 2)}\n`); }
console.log(S({ status: rec.status, error: rec.error?.slice(0, 300), opened: rec.opened, changed: rec.changed, style: rec.c0001?.text_style, preset: rec.c0001?.style_preset, card: rec.cardFonts, preview: rec.preview?.lines }));
