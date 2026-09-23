#!/usr/bin/env node
// 字幕の座布団の幅: captions.json の background（width_pct / fit）ごとに、シェルのプレビュー
// （frame-engine 経路 / 従来経路）で座布団の幅がどうなるかを実機で測る。BEFORE では台本の見た目タブの項目も記録する。
// 使い方: node l1-preview.mjs <fixture dir（gen-fixture.mjs の出力）> --phase=before|after [--projects=p-none,p-w100] [--port=9479]
// 測り方: プレビューのページ全体のスクリーンショットで、座布団（#ff0000）の最長の赤ランと、
// その少し上の行の背景色（#000040）のランを数える（= 絵の中での座布団の幅 / 画面の幅）。DOM の ::before の寸法も併記。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets } from '../../daihon-dock-surface/scripts/cdp-lib.mjs';
import { S, command, launch, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from '../../daihon-dock-surface/scripts/l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE = path.resolve(process.argv[2]);
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const PORT = Number(arg('port', 9479));
const PHASE = arg('phase', 'after');
const PROJECTS = arg('projects', PHASE === 'before' ? 'p-none,p-w100' : 'p-none,p-frame,p-frame-block,p-frame-pad16,p-pad16').split(',');
const MODES = arg('modes', 'frame-engine,legacy').split(',');
const RUNS = path.join(os.tmpdir(), 'caption-plate-fit-l1', 'runs');
const RESULTS = path.join(ROOT, `results-preview-${PHASE}.json`);
const out = { phase: PHASE, runs: [], screenshots: [] };

async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
// プレビューの webview（#preview-stage を持つ文脈）へつなぐ。
async function view(port) {
    let cdp, ctx;
    await waitFor('preview stage', async () => {
        const targets = (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
        for (const target of targets) {
            const client = new CDP(target.webSocketDebuggerUrl);
            try { await client.connect(); } catch { continue; }
            const contexts = []; client.on('Runtime.executionContextCreated', p => contexts.push(p.context));
            try { await client.send('Runtime.enable'); } catch { client.close(); continue; }
            await sleep(300);
            for (const c of [undefined, ...contexts.map(c => c.id)]) {
                try { if (await evalOn(client, `Boolean(document.getElementById('preview-stage'))`, c)) { cdp = client; ctx = c; return true; } } catch {}
            }
            client.close();
        }
        return false;
    }, 180_000);
    return { close: () => cdp?.close(), eval: expr => evalOn(cdp, expr, ctx) };
}
const PLATE_DOM = `(()=>{const px=v=>Math.round(v*100)/100;const stage=document.getElementById('preview-stage');
 const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
 const lines=[...document.querySelectorAll('.akari-caption__line')].filter(l=>l.getBoundingClientRect().width>0).map(l=>{const r=l.getBoundingClientRect();const b=getComputedStyle(l,'::before');const left=parseFloat(b.left),right=parseFloat(b.right);return{text:l.textContent,lineWidth:px(r.width),beforeLeft:b.left,beforeRight:b.right,beforeWidth:px(r.width-left-right),plateExtWidth:getComputedStyle(l).getPropertyValue('--plate-ext-width')||null,background:b.backgroundColor}});
 const pl=[...document.querySelectorAll('.akari-caption__plate')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>0).map(r=>({left:px(r.left-(c?c.left:0)),width:px(r.width)}));
 return{frameEngineActive:stage?.getAttribute('data-frame-engine-active')??null,frameWidth:c?px(c.width):null,frameLeft:c?px(c.left):null,captionPlateBoxes:pl,lines}})()`;

// スクリーンショット（PNG）の赤ランと背景ラン。
function pixelRuns(file) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString()).streams[0];
    const W = probe.width, H = probe.height;
    const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    const at = (x, y) => { const i = (y * W + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
    const isRed = ([r, g, b]) => r > 180 && g < 90 && b < 90;
    const isBg = ([r, g, b]) => r < 24 && g < 24 && b > 44 && b < 84;
    const longest = (y, pred) => { let best = 0, run = 0, start = -1, bestStart = -1; for (let x = 0; x < W; x++) { if (pred(at(x, y))) { if (!run) start = x; run++; if (run > best) { best = run; bestStart = start; } } else run = 0; } return { len: best, start: bestStart }; };
    let plate = { len: 0 }, top = -1, bottom = -1;
    for (let y = 0; y < H; y++) { const r = longest(y, isRed); if (r.len > 20) { if (top < 0) top = y; bottom = y; } if (r.len > plate.len) plate = { ...r, y }; }
    const frame = top > 6 ? longest(top - 6, isBg) : { len: 0 };
    return { plateWidthPx: plate.len, plateLeft: plate.start, plateRow: plate.y, plateHeightPx: top < 0 ? 0 : bottom - top + 1, frameWidthPx: frame.len, frameLeft: frame.start, ratio: frame.len ? Math.round(plate.len / frame.len * 1000) / 1000 : null };
}

async function openPreview(cdp, project, time) {
    await evalOn(cdp, command('akari.annotations.open'));
    await waitEval(cdp, `document.querySelectorAll('[class*="akari-timeline"]').length>0||Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))`, { label: 'timeline', timeoutMs: 120_000 });
    await waitFor('preview webview', async () => {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 180_000);
}
const DOCK = '.akari-daihon-dock';
async function lookTabFields(cdp) {
    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=2`, { label: 'daihon rows', timeoutMs: 180_000 });
    await sleep(2000);
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-10,y:b.top+6}})()`);
    await realClick(cdp, p.x, p.y);
    await waitEval(cdp, `(()=>{const d=document.querySelector(${S(DOCK)});return d&&d.classList.contains('open')})()`, { label: 'dock open', timeoutMs: 15_000 });
    await sleep(400);
    await evalOn(cdp, `(()=>{document.querySelector('${DOCK} [data-dock-tab="look"]').click();return true})()`);
    await sleep(600);
    const fields = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} [data-look-field]')].map(f=>({field:f.dataset.lookField,label:(f.querySelector('label')?.textContent||'').trim(),values:[...f.querySelectorAll('[data-look-value]')].map(b=>b.dataset.lookValue)}))`);
    const bodyText = await evalOn(cdp, `(document.querySelector('${DOCK} .akari-daihon-dock-body')?.textContent||'').trim()`);
    const file = `${PHASE}-look-tab.png`;
    await screenshot(cdp, path.join(ROOT, file)); out.screenshots.push(file);
    return { fields, hasWidthField: fields.some(f => /width|幅/.test(f.field + f.label)) || /幅/.test(bodyText), bodyText: bodyText.slice(0, 400) };
}

try {
    await mkdir(RUNS, { recursive: true });
    for (const mode of MODES) {
        for (const name of PROJECTS) {
            const iso = path.join(RUNS, `${mode}-${name}`);
            const project = path.join(FIXTURE, name);
            await import('node:fs/promises').then(fs => fs.rm(iso, { recursive: true, force: true }));
            await mkdir(iso, { recursive: true });
            await writeFile(path.join(iso, 'settings.json'), `${JSON.stringify({ 'akari.preview.frameEngine': mode === 'frame-engine' }, null, 2)}\n`);
            const run = { mode, project: name, background: JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8')).default_text_style.background, samples: [] };
            out.runs.push(run);
            let session;
            try {
                // 負荷の高い時間帯は CDP の初期化が間に合わないことがある。起動だけ 3 回まで試す（自分の PID だけ止める）。
                for (let attempt = 1; ; attempt++) {
                    try { session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir: iso, keepProfile: true }); break; }
                    catch (error) { if (attempt >= 3) throw error; run.launchRetries = attempt; await sleep(5000); }
                }
                const { cdp } = session;
                await openPreview(cdp, project, 0.5);
                await sleep(2500);
                const v = await view(PORT);
                for (const time of [0.5, 1.5]) {
                    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time }));
                    await waitFor('caption line', () => v.eval(`[...document.querySelectorAll('.akari-caption__line')].some(l=>l.getBoundingClientRect().width>0&&l.textContent===${S(time < 1 ? '短い' : 'これは少し長めの字幕の行です')})`), 60_000);
                    await sleep(1500);
                    const file = `${PHASE}-${mode}-${name}-${time}.png`;
                    await screenshot(cdp, path.join(ROOT, file)); out.screenshots.push(file);
                    run.samples.push({ time, dom: await v.eval(PLATE_DOM), pixels: pixelRuns(path.join(ROOT, file)) });
                    await saveJson(RESULTS, out);
                }
                v.close();
                if (PHASE === 'before' && mode === 'frame-engine' && name === PROJECTS[PROJECTS.length - 1]) out.lookTab = await lookTabFields(cdp);
            } catch (error) {
                run.error = sanitize(error, REPO);
            } finally {
                await stop(session);
                await saveJson(RESULTS, out);
            }
        }
    }
    out.status = out.runs.every(r => !r.error) ? 'measured' : 'partial';
} catch (error) {
    out.status = 'error'; out.error = sanitize(error, REPO);
} finally {
    await saveJson(RESULTS, out);
    console.log(JSON.stringify(out, null, 1).slice(0, 6000));
}
