#!/usr/bin/env node
// 書き出し（OSR）とプレビューの見た目の比較（ラッパー作成の検証スクリプト。変更後のビルドで実行する）。
// 編集パネルのカードで効果 3 種・動き 3 種を実際に当て（書き込みは UI 経由）、出力プレビューを同じ時刻へシークして
// 字幕の段を撮り、同じプロジェクトを render-cut --engine osr（worktree の Electron = tier 2）で書き出して同じ時刻のフレームを抜く。
//   c-0001 効果 ネオン ピンク / c-0002 効果 座布団 角丸 / c-0003 効果 袋文字 色違い
//   c-0004 動き テキストアニメ バウンス（登場） / c-0005 動き 組 タイプライター（登場） / c-0002 語ごとの表示 カラオケ（白文字で塗りが見える）
// 使い方: node gen-fixture.mjs <作業用>/fixture && node osr.mjs <作業用ディレクトリ（実体パス）>
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, openProject, paths, selectCaption, start } from './common.mjs';
import { view } from './view.mjs';

const WORK = process.argv[2];
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const EFFECT = '[data-akari-ui="section:inspector-style:effect"]';
const MOTION = '[data-akari-ui="section:inspector-motion:caption"]';
const tab = id => `(()=>{document.querySelector('[data-akari-ui="tab:inspector-${id}"]')?.click();return true})()`;
const card = (kind, id) => `${MOTION} .akari-caption-motion-card[data-motion-kind="${kind}"][data-motion-id="${id}"]`;
// 効果は字幕の後半の時刻・動きは再生途中の時刻（書き出しのフレームで途中と確かめた時刻: バウンス 9.1 秒・タイプライター 12.5 秒・カラオケ 4.2 秒 = 4 語中 2 語目）
export const SCENARIOS = [
    { key: 'effect-neon-pink', t: 1.5 }, { key: 'effect-bg-round', t: 5.3 }, { key: 'effect-ol-color', t: 8.2 },
    { key: 'motion-bounce-in', t: 9.1 }, { key: 'motion-typewriter-in', t: 12.5 }, { key: 'motion-karaoke', t: 4.2 }
];
const rec = { phase: 'osr', head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), writes: {}, scenarios: SCENARIOS };
let session;
const p = paths(WORK, 'bag');
const frames = path.join(WORK, 'osr-frames');
try {
    await rm(frames, { recursive: true, force: true }); await mkdir(frames, { recursive: true });
    session = await start(p); const cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    await dismissToasts(cdp);
    const pick = async (id, tabId, sel) => {
        await selectCaption(cdp, id); await evalOn(cdp, tab(tabId)); await sleep(1200);
        await clickSel(cdp, sel); await sleep(3000);
    };
    await pick('c-0001', 'text', `${EFFECT} .akari-effect-card[data-value="neon-pink"]`);
    await pick('c-0002', 'text', `${EFFECT} .akari-effect-card[data-value="bg-round"]`);
    await pick('c-0003', 'text', `${EFFECT} .akari-effect-card[data-value="ol-color"]`);
    await pick('c-0002', 'motion', card('word-style', 'karaoke'));
    await pick('c-0004', 'motion', card('textanim', 'bounce'));
    await pick('c-0005', 'motion', card('combo', 'typewriter'));
    const captions = JSON.parse(await readFile(path.join(p.PJ, 'captions.json'), 'utf8'));
    for (const c of captions.captions) rec.writes[c.id] = { text_style: c.text_style ?? null, style: c.style ?? null };
    // 選択の枠・道具を消してから撮る（字幕の段だけを比べる）
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await evalOn(cdp, command('akari.timeline.clearSelection')).catch(() => {});
    const v = await view(Number(process.env.CDP_PORT || 9636));
    await v.eval(`(()=>{const s=document.createElement('style');s.textContent='.akari-caption-select-tools,.akari-caption-handle-box,.akari-caption-handle,[class*="select-box"],[class*="selection"]{display:none!important}';document.head.appendChild(s);return true})()`);
    const frameRect = await evalOn(cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top}})()`);
    for (const sc of SCENARIOS) {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: sc.t }));
        await sleep(2500);
        const stage = await v.eval(`(()=>{const r=document.getElementById('preview-stage').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
        const clip = { x: frameRect.left + stage.x, y: frameRect.top + stage.y, width: stage.width, height: stage.height, scale: 1 };
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
        await writeFile(path.join(frames, `preview-${sc.key}.png`), Buffer.from(data, 'base64'));
    }
    v.close();
    await stop(session); session = null;
    try { execFileSync('/usr/bin/pkill', ['-f', p.ISO]); } catch {}

    // 書き出し（OSR・tier 2）
    const project = path.join(WORK, 'osr-project');
    await rm(project, { recursive: true, force: true });
    await cp(p.PJ, project, { recursive: true });
    const outFile = path.join(project, 'exports', 'osr.mp4');
    const started = Date.now();
    const render = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', 'osr', '--out', outFile],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0' } });
    rec.renderSeconds = Math.round((Date.now() - started) / 1000);
    rec.renderExit = render.status;
    if (render.status !== 0) throw new Error(`render-cut exit ${render.status}: ${(render.stderr || render.stdout).slice(-2000)}`);
    const renderJson = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    const tiers = {};
    const walk = (value, trail) => { if (!value || typeof value !== 'object') return; for (const [k, val] of Object.entries(value)) { if (k === 'launcher_tier') tiers[trail.concat(k).join('.')] = val; else walk(val, trail.concat(k)); } };
    walk(renderJson.provenance ?? {}, ['provenance']);
    rec.engine = renderJson.provenance?.engine ?? renderJson.engine ?? null;
    rec.launcherTiers = tiers;
    rec.osrLogFallback = /フォールバック/.test(String(render.stderr) + String(render.stdout));
    for (const sc of SCENARIOS) {
        const x = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(sc.t), '-i', outFile, '-frames:v', '1', path.join(frames, `osr-${sc.key}.png`)]);
        if (x.status !== 0) throw new Error(`frame extract failed: ${x.stderr}`);
        // 並べた比較画像（上 = プレビュー・下 = 書き出し。字幕の段の下半分を 960 幅で）
        const y = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', path.join(frames, `preview-${sc.key}.png`), '-i', path.join(frames, `osr-${sc.key}.png`),
            '-filter_complex', '[0:v]scale=960:540,crop=960:270:0:270[a];[1:v]scale=960:540,crop=960:270:0:270[b];[a][b]vstack', '-frames:v', '1', path.join(OUT, `osr-compare-${sc.key}.png`)]);
        if (y.status !== 0) throw new Error(`compare failed: ${y.stderr}`);
    }
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-osr.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, tiers: rec.launcherTiers, engine: rec.engine, renderSeconds: rec.renderSeconds }));
