#!/usr/bin/env node
// caption-export-fonts の L1（アプリ実機）: プレビューの字幕を各 cue の中央時刻で撮り、webview の document.fonts を記録する。
// PANEL=1 のときは続けて、フォントのパネルで c-0001 に Zen Maru Gothic の 700 を選ぶ（captions.json への書き込みを確認）。
// 使い方: node preview-l1.mjs <fixture 名（fx/ 配下）> <出力 frames ディレクトリ>
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WORK, start, stop, openProject, evalOn, screenshot, previewFrame, sleep, S, exec, realClick, waitEval } from './lib.mjs';
const [fixture, outDir] = process.argv.slice(2);
const PJ = path.join(WORK, `ws-caption-export-fonts-${fixture}`);
execFileSync('/bin/sh', ['-c', `rm -rf "${PJ}" && mkdir -p "${PJ}" && (cd <work>/fx/${fixture} && git archive HEAD) | tar -x -C "${PJ}" && cd "${PJ}" && git init -q && git add -A && git -c user.email=l1@localhost -c user.name=l1 commit -qm fixture`]);
await mkdir(outDir, { recursive: true });
const rec = { fixture, cues: [] };
const session = await start(PJ);
const cdp = session.cdp;
const editUri = `file://${path.join(PJ, 'edit.json')}`;
async function stageContext(pf) {
  const ctxs = [];
  const handler = e => ctxs.push(e.context);
  pf.on('Runtime.executionContextCreated', handler);
  await pf.send('Runtime.disable'); await pf.send('Runtime.enable'); await sleep(400);
  for (const c of ctxs) { try { if (await evalOn(pf, `Boolean(document.querySelector('canvas'))`, c.id)) return c.id; } catch {} }
  return null;
}
try {
  await openProject(session, PJ, 0.5);
  let pf = await previewFrame(); let ctx = await stageContext(pf);
  for (let i = 1; i <= 18; i++) {
    const t = i - 0.5;
    await evalOn(cdp, exec('akari.preview.seekOutput', { editUri, time: t }));
    await sleep(1800);
    let fonts;
    try { fonts = await evalOn(pf, `(async()=>{await document.fonts.ready;return{status:document.fonts.status,faces:[...document.fonts].filter(f=>f.status!=='unloaded').map(f=>f.family+' '+f.weight+' '+f.status),caption:[...document.querySelectorAll('.akari-caption__line')].map(e=>{const cs=getComputedStyle(e);return cs.fontFamily+' '+cs.fontWeight+' '+e.textContent})}})()`, ctx); }
    catch { pf.close(); pf = await previewFrame(); ctx = await stageContext(pf); fonts = { error: 'context reset' }; }
    await sleep(400);
    const iframe = await evalOn(cdp, `(()=>{const f=[...document.querySelectorAll('iframe')].find(f=>/webview/.test(f.src));const r=f.getBoundingClientRect();return{x:r.x,y:r.y}})()`);
    const canvas = await evalOn(pf, `(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`, ctx);
    const clip = { x: iframe.x + canvas.x, y: iframe.y + canvas.y, width: canvas.w, height: canvas.h, scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
    const raw = path.join(outDir, `raw-${String(i).padStart(2, '0')}.png`);
    await writeFile(raw, Buffer.from(data, 'base64'));
    // 比較画像の切り出し座標（1280x720 基準）に合わせて拡大する
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf', 'scale=1280:720:flags=lanczos', path.join(outDir, `cue-${String(i).padStart(2, '0')}.png`)]);
    rec.cues.push({ i, t, clip, fonts });
  }
  if (process.env.PANEL === '1') {
    const readCaptions = async () => JSON.parse(await readFile(path.join(PJ, 'captions.json'), 'utf8'));
    const before = S(await readCaptions());
    await evalOn(cdp, exec('akari.preview.seekOutput', { editUri, time: 0.5 }));
    await evalOn(cdp, exec('akari.timeline.selectCaptions', { editUri, captionIds: ['c-0001'] }));
    await sleep(1500);
    await evalOn(cdp, exec('akari.captionPanel.toggle', { panel: 'font' }));
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-caption-panel="font"] [data-akari-font-row="zen-maru-gothic"]'))`, { label: 'font panel row', timeoutMs: 30_000 });
    await sleep(1500);
    await screenshot(cdp, path.join(outDir, 'panel-01-open.png'));
    const at = async sel => evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    let p = await at('[data-akari-font-chevron="zen-maru-gothic"]'); await realClick(cdp, p.x, p.y); await sleep(1000);
    await waitEval(cdp, `Boolean(document.querySelector('[data-akari-font-row="zen-maru-gothic"] [data-akari-font-weight="700"]'))`, { label: 'weight 700', timeoutMs: 10_000 });
    await screenshot(cdp, path.join(outDir, 'panel-02-weights.png'));
    p = await at('[data-akari-font-row="zen-maru-gothic"] [data-akari-font-weight="700"]'); await realClick(cdp, p.x, p.y);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && S(await readCaptions()) === before) await sleep(250);
    await sleep(2000);
    rec.panel = { changed: S(await readCaptions()) !== before, c0001: (await readCaptions()).captions.find(c => c.id === 'c-0001') };
    await screenshot(cdp, path.join(outDir, 'panel-03-applied.png'));
    rec.panel.previewFonts = await evalOn(pf, `(async()=>{await document.fonts.ready;return[...document.querySelectorAll('.akari-caption__line')].map(e=>{const cs=getComputedStyle(e);return cs.fontFamily+' '+cs.fontWeight})})()`, ctx).catch(e => String(e));
    rec.panel.project = PJ;
  }
  rec.status = 'ok';
} catch (error) { rec.status = 'error'; rec.error = String(error?.stack || error); }
finally { await stop(session); await writeFile(path.join(outDir, 'preview-l1.json'), `${JSON.stringify(rec, null, 2)}\n`); }
console.log(S({ status: rec.status, error: rec.error?.slice(0, 300), panel: rec.panel?.changed, c0001: rec.panel?.c0001?.text_style }));
