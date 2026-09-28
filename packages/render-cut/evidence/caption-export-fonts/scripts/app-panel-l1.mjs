#!/usr/bin/env node
// caption-export-fonts の L1（アプリ実機）: タイムラインで字幕 c-0001 のチップを押して選び、プレビュー上のバーの「フォント」→
// フォントのパネルで Zen Maru Gothic の太さ 700 を選ぶ。captions.json への書き込みとプレビューの computed font を記録する。
// 使い方: node panel-l1.mjs <fixture 名> <出力ディレクトリ>
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WORK, start, stop, openProject, evalOn, screenshot, previewFrame, sleep, S, exec, realClick, waitEval } from './lib.mjs';
const [fixture, outDir] = process.argv.slice(2);
const PJ = path.join(WORK, `ws-caption-export-fonts-panel`);
execFileSync('/bin/sh', ['-c', `rm -rf "${PJ}" && mkdir -p "${PJ}" && (cd <work>/fx/${fixture} && git archive HEAD) | tar -x -C "${PJ}" && cd "${PJ}" && git init -q && git add -A && git -c user.email=l1@localhost -c user.name=l1 commit -qm fixture`]);
await mkdir(outDir, { recursive: true });
const rec = { fixture, project: PJ, steps: [] };
const session = await start(PJ);
const cdp = session.cdp;
const editUri = `file://${path.join(PJ, 'edit.json')}`;
const readCaptions = async () => JSON.parse(await readFile(path.join(PJ, 'captions.json'), 'utf8'));
// 右下の通知（はじめてのガイド）が行の右半分に重なるので、要素の左端寄りを押す
const at = async sel => waitEval(cdp, `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.x+Math.min(r.width/2,24),y:r.y+r.height/2}:null})()`, { label: sel, timeoutMs: 20_000 });
const dismissToasts = () => evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
try {
  await openProject(session, PJ, 0.5);
  await dismissToasts();
  const before = S(await readCaptions());
  let p = await at('.akari-annotations-strip-caption'); await realClick(cdp, p.x, p.y); await sleep(1500);
  rec.steps.push('clicked first caption chip');
  await screenshot(cdp, path.join(outDir, 'panel-00-selected.png'));
  const opened = await evalOn(cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return await window.theia.container.get(C).executeCommand('akari.captionPanel.toggle',{panel:'font'})})()`);
  rec.steps.push(`toggle font panel -> ${opened}`);
  await waitEval(cdp, `Boolean(document.querySelector('[data-akari-caption-panel="font"] [data-akari-font-row="zen-maru-gothic"]'))`, { label: 'font panel row', timeoutMs: 30_000 });
  await sleep(1500);
  rec.panelRows = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-caption-panel="font"] [data-akari-font-row]')].map(e=>e.getAttribute('data-akari-font-row'))`);
  await screenshot(cdp, path.join(outDir, 'panel-01-open.png'));
  p = await at('[data-akari-font-chevron="zen-maru-gothic"]'); await realClick(cdp, p.x, p.y); await sleep(1000);
  p = await at('[data-akari-font-row="zen-maru-gothic"] [data-akari-font-weight="700"]');
  await dismissToasts(); await sleep(500);
  rec.hitAt700 = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${p.x},${p.y});return e?e.outerHTML.slice(0,120):null})()`);
  await screenshot(cdp, path.join(outDir, 'panel-02-weights.png'));
  await realClick(cdp, p.x, p.y);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && S(await readCaptions()) === before) await sleep(250);
  await sleep(2500);
  const after = await readCaptions();
  rec.changed = S(after) !== before;
  rec.c0001 = after.captions.find(c => c.id === 'c-0001');
  await evalOn(cdp, exec('akari.captionPanel.close'));
  await evalOn(cdp, exec('akari.preview.seekOutput', { editUri, time: 0.5 })); await sleep(2000);
  await screenshot(cdp, path.join(outDir, 'panel-03-applied.png'));
  const pf = await previewFrame();
  const ctxs = []; pf.on('Runtime.executionContextCreated', e => ctxs.push(e.context));
  await pf.send('Runtime.disable'); await pf.send('Runtime.enable'); await sleep(400);
  for (const c of ctxs) { try { const v = await evalOn(pf, `(async()=>{await document.fonts.ready;const l=[...document.querySelectorAll('.akari-caption__line')];return l.length?l.map(e=>{const cs=getComputedStyle(e);return cs.fontFamily+' '+cs.fontWeight}):null})()`, c.id); if (v) rec.previewComputed = v; } catch {} }
  rec.status = 'ok';
} catch (error) { rec.status = 'error'; rec.error = String(error?.stack || error); await screenshot(cdp, path.join(outDir, 'panel-error.png')).catch(() => {}); }
finally { await stop(session); await writeFile(path.join(outDir, 'panel-l1.json'), `${JSON.stringify(rec, null, 2)}\n`); }
console.log(S({ status: rec.status, error: rec.error?.slice(0, 300), steps: rec.steps, changed: rec.changed, style: rec.c0001?.text_style, preview: rec.previewComputed }));
