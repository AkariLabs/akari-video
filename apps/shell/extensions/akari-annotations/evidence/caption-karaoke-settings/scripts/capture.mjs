#!/usr/bin/env node
// プレビューと OSR 書き出しの同じ時刻のフレームを撮って並べる（ラッパー作成の検証スクリプト。effects-motion-tabs の osr.mjs の写しを改変）。
// fixture のプロジェクト（gen-fixture.mjs の出力）をそのまま開き、出力プレビューを各時刻へシークして字幕の段を撮る。
// 同じ時刻のカラオケの語の DOM（クラス・計算後の色・アニメーション）も記録する。
// その後 render-cut --engine osr（worktree の Electron = tier 2）で書き出し、同じ時刻のフレームを抜いて上下に並べ、PSNR（参考値）を出す。
// 使い方: node capture.mjs <作業用ディレクトリ> <fixture 名> <phase 名> <key=秒> [key=秒 ...]
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, PORT, REPO, S, dismissToasts, openProject, paths, start } from './common.mjs';
import { view } from './view.mjs';

const [WORK, NAME, PHASE, ...specs] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const SCENARIOS = specs.map(s => { const [key, t] = s.split('='); return { key, t: Number(t) }; });
const rec = { phase: PHASE, fixture: NAME, head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), scenarios: SCENARIOS, dom: {}, psnr: {} };
const TOKENS = `(()=>{const out=[];for(const p of document.querySelectorAll('.caption-row-plate')){const cs0=getComputedStyle(p);if(cs0.display==='none'||cs0.visibility==='hidden')continue;const toks=[...p.querySelectorAll('[class*="akari-caption__tok"], [class*="akari-caption__char"]')];if(!toks.length)continue;out.push({plate:p.id,vars:['--caption-highlight-color','--caption-text-color','--caption-karaoke-done-color'].map(k=>[k,getComputedStyle(p.querySelector('.akari-caption__line')||p).getPropertyValue(k)]),tokens:toks.slice(0,24).map(t=>{const cs=getComputedStyle(t);return{cls:t.className,text:t.textContent,color:cs.color,bgImage:cs.backgroundImage.slice(0,120),clip:cs.webkitBackgroundClip||cs.backgroundClip,bgPos:cs.backgroundPosition,anim:cs.animationName,delay:cs.animationDelay,dur:cs.animationDuration,timing:cs.animationTimingFunction,play:cs.animationPlayState,style:t.getAttribute('style')}})})}return out})()`;
let session;
const p = paths(WORK, NAME);
const frames = path.join(WORK, `frames-${PHASE}`);
try {
    await rm(frames, { recursive: true, force: true }); await mkdir(frames, { recursive: true });
    session = await start(p); const cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    await dismissToasts(cdp);
    await evalOn(cdp, command('akari.timeline.clearSelection')).catch(() => {});
    const v = await view(PORT);
    await v.eval(`(()=>{const s=document.createElement('style');s.textContent='.akari-caption-select-tools,.akari-caption-handle-box,.akari-caption-handle,[class*="select-box"],[class*="selection"]{display:none!important}';document.head.appendChild(s);return true})()`);
    const frameRect = await evalOn(cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(f=>f.getBoundingClientRect()).filter(r=>r.width>200&&r.height>200).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return{left:r.left,top:r.top}})()`);
    for (const sc of SCENARIOS) {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: sc.t }));
        await sleep(2500);
        const stage = await v.eval(`(()=>{const r=document.getElementById('preview-stage').getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()`);
        const clip = { x: frameRect.left + stage.x, y: frameRect.top + stage.y, width: stage.width, height: stage.height, scale: 1 };
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
        await writeFile(path.join(frames, `preview-${sc.key}.png`), Buffer.from(data, 'base64'));
        rec.dom[sc.key] = await v.eval(TOKENS).catch(e => ({ error: String(e.message).slice(0, 300) }));
    }
    v.close();
    await stop(session); session = null;
    try { execFileSync('/usr/bin/pkill', ['-f', p.ISO]); } catch {}

    const project = path.join(WORK, `osr-project-${PHASE}`);
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
        const crop = 'scale=960:540,crop=960:200:0:340';
        const y = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', path.join(frames, `preview-${sc.key}.png`), '-i', path.join(frames, `osr-${sc.key}.png`),
            '-filter_complex', `[0:v]${crop}[a];[1:v]${crop}[b];[a][b]vstack`, '-frames:v', '1', path.join(OUT, `${PHASE}-${sc.key}.png`)]);
        if (y.status !== 0) throw new Error(`compare failed: ${y.stderr}`);
        const z = spawnSync(FFMPEG, ['-hide_banner', '-nostdin',
            '-i', path.join(frames, `preview-${sc.key}.png`), '-i', path.join(frames, `osr-${sc.key}.png`),
            '-filter_complex', `[0:v]${crop},format=rgb24[a];[1:v]${crop},format=rgb24[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf8' });
        rec.psnr[sc.key] = Number((/average:([\d.]+|inf)/.exec(z.stderr) ?? [])[1] ?? NaN);
    }
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    try { execFileSync('/usr/bin/pkill', ['-f', p.ISO]); } catch {}
    await writeFile(path.join(OUT, `results-${PHASE}.json`), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, tiers: rec.launcherTiers, engine: rec.engine, renderSeconds: rec.renderSeconds, psnr: rec.psnr }));
