#!/usr/bin/env node
// 手順 1 の見た目比較（ラッパー作成の検証スクリプト）: 同梱スタイル全件について
//   見本（テキストのページのカード）/ プレビュー（出力プレビューの webview）/ OSR 書き出し（render-cut --engine osr）
// を 1 枚の一覧画像（after-styles-sheet.png）にまとめ、プレビューと書き出しの PSNR を results-after-styles.json に残す。
// 使い方: node gen-styles-fixture.mjs <作業用>/fixture && node after-styles.mjs <作業用ディレクトリ（実体パス）>
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { OUT, PORT, REPO, S, exec, openProject, openTextPage, paths, shooter, start } from './common.mjs';

const work = process.argv[2];
const p = { ...paths(work), PJ: path.join(work, 'ws-textstyle-lab-crown-styles') };
const rec = { phase: 'after-styles', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), styles: [] };
const shot = shooter(p, 'after');
const tiles = path.join(work, 'tiles');
await rm(tiles, { recursive: true, force: true }); await mkdir(tiles, { recursive: true });
const rows = (await readFile(path.join(REPO, 'presets/textstyle/index.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(work, 'fixture', 'styles'), p.PJ, { recursive: true });
const t0 = Date.now();
const session = await start(p);
const cdp = session.cdp;
const clip = async (rect, file) => {
    const shotData = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
    await writeFile(file, Buffer.from(shotData.data, 'base64'));
};
try {
    await openProject(session, p.PJ, 0.5);
    await openTextPage(cdp);
    await waitEval(cdp, `document.querySelectorAll('[data-akari-text-look-section="style"] [data-akari-catalog-preset-item^="textstyle/"]').length>0`, { label: 'textstyle cards', timeoutMs: 60_000 });
    await sleep(1500);
    rec.cardIds = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-text-look-section="style"] [data-akari-catalog-preset-item^="textstyle/"]')].map(e=>e.getAttribute('data-akari-catalog-preset-item').slice(10))`);
    rec.cardCount = rec.cardIds.length;
    rec.shots = [await shot(cdp, 'styles-00-text-page-style')];
    // 見本（カード）
    for (const row of rows) {
        const rect = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(`[data-akari-text-look-section="style"] [data-akari-catalog-preset-item="textstyle/${row.id}"]`)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
        if (!rect) throw new Error(`card not found: ${row.id}`);
        await sleep(250);
        await clip(rect, path.join(tiles, `${row.id}-card.png`));
    }
    // プレビュー（出力プレビューの webview をページの座標で切り取る）
    const frameRect = `(()=>{const f=[...document.querySelectorAll('iframe')].map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width>200&&x.r.height>150).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];return f?{x:f.r.left,y:f.r.top,width:f.r.width,height:f.r.height}:null})()`;
    const webview = (await listTargets(PORT)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    rec.previewFrame = await evalOn(cdp, frameRect);
    // 出力の絵（16:9 の枠）だけを切り出すため、webview の中で #preview-stage とその子の矩形を測る
    const wv = new CDP(webview.webSocketDebuggerUrl); await wv.connect();
    const contexts = []; wv.on('Runtime.executionContextCreated', e => contexts.push(e.context.id));
    await wv.send('Runtime.enable'); await sleep(500);
    const STAGE = `(()=>{const s=document.getElementById('preview-stage');if(!s)return null;const cands=[s,...s.querySelectorAll('canvas,video,div')].map(e=>{const r=e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}}).filter(r=>r.width>100&&r.height>50);cands.sort((a,b)=>Math.abs(a.width/a.height-16/9)-Math.abs(b.width/b.height-16/9)||b.width*b.height-a.width*a.height);return cands[0]})()`;
    for (const ctx of [undefined, ...contexts]) { try { rec.stageInFrame = await evalOn(wv, STAGE, ctx); if (rec.stageInFrame) break; } catch {} }
    wv.close();
    if (!rec.stageInFrame) throw new Error('preview stage rect not found');
    const stageRect = f => ({ x: f.x + rec.stageInFrame.x, y: f.y + rec.stageInFrame.y, width: rec.stageInFrame.width, height: rec.stageInFrame.height });
    for (const [index, row] of rows.entries()) {
        await evalOn(cdp, exec('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: index + 0.75 }));
        await sleep(1800);
        await clip(stageRect(await evalOn(cdp, frameRect)), path.join(tiles, `${row.id}-preview-raw.png`));
    }
    rec.webviewTarget = Boolean(webview);
    rec.shots.push(await shot(cdp, 'styles-01-preview-last'));
    rec.appSecs = Math.round((Date.now() - t0) / 1000);
} catch (error) {
    rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
}
// OSR 書き出し（tier 2 = worktree の Electron。インストール済みアプリは使わない）
const exportFile = path.join(p.PJ, 'exports', 'styles-osr.mp4');
const t1 = Date.now();
const env = { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0', AKARI_HOME: path.join(p.ISO, 'akari-home') };
delete env.ELECTRON_RUN_AS_NODE;
const render = spawnSync(process.execPath, [path.join(REPO, 'packages/render-cut/bin/render-cut.mjs'), p.PJ, '--engine', 'osr', '--out', exportFile, '--force'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 << 20 });
rec.export = { exit: render.status, secs: Math.round((Date.now() - t1) / 1000), tail: sanitize(String(render.stdout + render.stderr).split('\n').slice(-6).join('\n'), REPO) };
try {
    const receipt = JSON.parse(await readFile(path.join(p.PJ, '.akari', 'render.json'), 'utf8'));
    rec.export.engine = receipt.provenance?.engine ?? receipt.engine ?? null;
    rec.export.launcher_tier = receipt.provenance?.osr?.provenance?.launcher_tier ?? null;
} catch (error) { rec.export.receiptError = sanitize(error, REPO); }
rec.export.ffprobe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', exportFile], { encoding: 'utf8' });
// 1 件ずつ: 書き出しのコマ・プレビューを同じ大きさ（480x270）に揃え、PSNR を測り、見本と横に並べる
const psnr = (a, b) => { const r = spawnSync('magick', ['compare', '-metric', 'PSNR', a, b, 'null:'], { encoding: 'utf8' }); return Number.parseFloat(r.stderr) || r.stderr.trim(); };
for (const [index, row] of rows.entries()) {
    const base = path.join(tiles, row.id);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(index + 0.75), '-i', exportFile, '-frames:v', '1', '-vf', 'scale=480:270', `${base}-export.png`]);
    execFileSync('magick', [`${base}-preview-raw.png`, '-resize', '480x270!', `${base}-preview.png`]);
    execFileSync('magick', [`${base}-card.png`, '-resize', 'x270', `${base}-card-h.png`]);
    const value = psnr(`${base}-preview.png`, `${base}-export.png`);
    rec.styles.push({ id: row.id, name: row.name, psnr_preview_vs_export: value });
    execFileSync('magick', [`${base}-card-h.png`, `${base}-preview.png`, `${base}-export.png`, '+append',
        '-background', '#202020', '-fill', 'white', '-font', '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', '-pointsize', '22', `label:${row.id}  ${row.name}  （見本 / プレビュー / OSR 書き出し）PSNR ${typeof value === 'number' ? value.toFixed(1) : value} dB`,
        '-swap', '0,1', '-append', `${base}-row.png`]);
}
execFileSync('montage', ['-font', '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', ...rows.map(row => path.join(tiles, `${row.id}-row.png`)), '-tile', '3x', '-geometry', '+8+8', '-background', '#111111', path.join(work, 'sheet-full.png')]);
execFileSync('magick', [path.join(work, 'sheet-full.png'), '-resize', '3000x>', '-quality', '85', path.join(OUT, 'after-styles-sheet.jpg')]);
rec.sheet = 'after-styles-sheet.jpg';
await writeFile(path.join(OUT, 'results-after-styles.json'), `${S(rec, null, 2)}\n`);
console.log(S({ error: rec.error, cards: rec.cardCount, export: rec.export.exit, tier: rec.export.launcher_tier, minPsnr: Math.min(...rec.styles.map(s => typeof s.psnr_preview_vs_export === 'number' ? s.psnr_preview_vs_export : 999)) }));
