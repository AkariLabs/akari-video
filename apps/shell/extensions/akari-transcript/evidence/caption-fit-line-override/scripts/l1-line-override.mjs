#!/usr/bin/env node
// 既定が「画面幅」（default_text_style.background.fit: "frame"）の案件で、行ごとに「文字に合わせる」へ戻せるかを実機で確かめる。
//   1 1 行目 → ドック → 見た目タブを開いた時点の選択印（座布団の幅・座布団の色）
//   2 「文字に合わせる」→ captions.json の 1 行目 / プレビューの座布団（1 行目 0.5 秒・2 行目 1.5 秒）→ Cmd+Z 1 手で byte 一致
//   3 （AFTER のみ）「文字に合わせる」→「画面幅」→ 1 行目の fit が消える（既定に従う）
// BEFORE は記録のみ（期待値の assert をしない）。AFTER は受け入れ条件を assert する。
// 使い方: node l1-line-override.mjs <fixture dir（gen-fixture.mjs の出力）> --phase=<before|after> [--port=9483]
import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets } from '../../daihon-dock-surface/scripts/cdp-lib.mjs';
import { S, command, launch, pressKey, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from '../../daihon-dock-surface/scripts/l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const arg = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const FIXTURE = path.resolve(process.argv[2]);
const PHASE = arg('phase', 'after');
const AFTER = PHASE === 'after';
const PORT = Number(arg('port', 9483));
const PROJECT = path.join(FIXTURE, 'p-default-frame');
const ISO = path.join(os.tmpdir(), 'caption-fit-line-override-l1', 'runs', PHASE);
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const out = { phase: PHASE, status: 'running', checks: [], screenshots: [] };
const META = 4;
const DOCK = '.akari-daihon-dock';
const EDIT_URI = `file://${path.join(PROJECT, 'edit.json')}`;

const assert = (condition, message) => { if (AFTER && !condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO); }
    finally { await saveJson(RESULTS, out); }
    return record.detail;
}
async function shot(cdp, name) {
    await sleep(500);
    const file = `${PHASE}-${name}`;
    await screenshot(cdp, path.join(ROOT, file));
    out.screenshots.push(file);
    return path.join(ROOT, file);
}
const captionsRaw = () => readFile(path.join(PROJECT, 'captions.json'), 'utf8');
const captionOf = (raw, id) => { const parsed = JSON.parse(raw); return (Array.isArray(parsed) ? parsed : parsed.captions).find(c => c.id === id); };
async function waitRaw(predicate, label, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const raw = await captionsRaw(); if (predicate(raw)) return raw; } catch {}
        await sleep(200);
    }
    throw new Error(`${label} not reached`);
}
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(250); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const center = selector => `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`;
async function clickAt(cdp, selector) {
    const p = await waitEval(cdp, center(selector), { label: `${selector} visible`, timeoutMs: 30_000 });
    await realClick(cdp, p.x, p.y);
}
const undo = async cdp => {
    await evalOn(cdp, `(()=>{document.querySelector('.akari-daihon-rows')?.focus({preventScroll:true});return true})()`);
    await sleep(150);
    await pressKey(cdp, 'z', 'KeyZ', 90, META);
};
const LOOK_STATE = `(()=>{const q=f=>document.querySelector('${DOCK} [data-look-field="'+f+'"]');const fit=q('fit');const bg=q('background');const color=q('color');
 const pick=(f,attr)=>f?[...f.querySelectorAll('[data-look-value]')].filter(b=>attr==='pressed'?b.getAttribute('aria-pressed')==='true':b.classList.contains('selected')).map(b=>b.dataset.lookValue):null;
 return{fitButtons:fit?[...fit.querySelectorAll('[data-look-value]')].map(b=>({value:b.dataset.lookValue,label:(b.textContent||'').trim(),disabled:b.disabled,pressed:b.getAttribute('aria-pressed')})):null,
  fitPressed:pick(fit,'pressed'),backgroundSelected:pick(bg,'selected'),colorSelected:pick(color,'selected')}})()`;
const NOTIFICATIONS = `[...document.querySelectorAll('.theia-notification-message, .theia-notification-list-item-content-main')].map(e=>(e.textContent||'').trim()).filter(Boolean).slice(-5)`;

// プレビューの webview（#preview-stage を持つ文脈）
async function view() {
    let cdp, ctx;
    await waitFor('preview stage', async () => {
        const targets = (await listTargets(PORT)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
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
const PLATE_DOM = text => `(()=>{const px=v=>Math.round(v*100)/100;
 const lines=[...document.querySelectorAll('.akari-caption__line')].filter(l=>l.getBoundingClientRect().width>0);
 const line=lines.find(l=>(l.textContent||'').trim()===${S(text)});const lr=line?.getBoundingClientRect();
 const plate=line?.closest('.akari-caption__plate')?.getBoundingClientRect()??[...document.querySelectorAll('.akari-caption__plate')].map(e=>e.getBoundingClientRect()).find(r=>r.width>0);
 return{captionPlateBoxWidth:plate?px(plate.width):null,visibleLines:lines.map(l=>(l.textContent||'').trim()),lineText:line?(line.textContent||'').trim():null,lineWidth:lr?px(lr.width):null,lineHeight:lr?px(lr.height):null,
  fitVar:line?getComputedStyle(line).getPropertyValue('--caption-plate-fit').trim()||null:null}})()`;
// 座布団の黄 #facc15 の最長ラン（スクリーンショット全体）
function yellowRun(file) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString()).streams[0];
    const W = probe.width, H = probe.height;
    const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    const yellow = (x, y) => { const i = (y * W + x) * 3; return buf[i] > 200 && buf[i + 1] > 160 && buf[i + 1] < 235 && buf[i + 2] < 90; };
    let best = 0;
    for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { if (yellow(x, y)) { run++; if (run > best) best = run; } else run = 0; } }
    return best;
}
async function seek(cdp, time) {
    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: EDIT_URI, time }));
    await sleep(1500);
}

let session;
try {
    await rm(ISO, { recursive: true, force: true });
    for (let attempt = 1; ; attempt++) {
        try { session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PROJECT, port: PORT, isoDir: ISO, keepProfile: true }); break; }
        catch (error) { if (attempt >= 3) throw error; out.launchRetries = attempt; await sleep(5000); }
    }
    const { cdp } = session;
    await evalOn(cdp, command('akari.annotations.open'));
    await waitFor('preview webview', async () => {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: EDIT_URI, time: 0.5 }));
        await sleep(3000);
        return (await listTargets(PORT)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url));
    }, 180_000);
    await sleep(2500);
    let current = await view();
    // captions.json の書き込みでプレビューの webview が作り直されることがあるので、評価に失敗したらつなぎ直す。
    const v = { close: () => current.close(), eval: async expr => {
        try { return await current.eval(expr); }
        catch { current.close(); current = await view(); return current.eval(expr); }
    } };
    const LINE1 = '短い', LINE2 = 'これは少し長めの字幕の行です';
    let last = null;
    const plateAt = async (time, text, accept = () => true, timeoutMs = 60_000) => waitFor(`caption line ${text}`, async () => {
        await seek(cdp, time);
        const d = await v.eval(PLATE_DOM(text)); last = d;
        return d.lineText === text && accept(d) ? d : null;
    }, timeoutMs).catch(error => { throw new Error(`${error.message}: last ${JSON.stringify(last)}`); });
    const ratio = d => Math.round(d.lineWidth / d.captionPlateBoxWidth * 1000) / 1000;
    out.previewInitial = { line1: await plateAt(0.5, LINE1), line2: await plateAt(1.5, LINE2) };

    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=2`, { label: 'daihon rows', timeoutMs: 180_000 });
    await sleep(2000);
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-10,y:b.top+6}})()`);
    await realClick(cdp, p.x, p.y);
    await waitEval(cdp, `(()=>{const d=document.querySelector(${S(DOCK)});return d&&d.classList.contains('open')})()`, { label: 'dock open', timeoutMs: 15_000 });
    await sleep(400);
    await clickAt(cdp, `${DOCK} [data-dock-tab="look"]`);
    await sleep(800);

    await check('1 見た目タブを開いた時点の選択印（既定 frame・既定の座布団の色 #facc15）', async () => {
        const look = await evalOn(cdp, LOOK_STATE);
        await shot(cdp, '01-look-tab.png');
        assert(look.fitPressed?.join() === 'frame', `fit pressed ${look.fitPressed}`);
        assert(look.backgroundSelected?.join().toLowerCase() === '#facc15', `background selected ${look.backgroundSelected}`);
        assert(look.fitButtons.every(b => !b.disabled), 'fit buttons disabled');
        return look;
    });

    await check('2 「文字に合わせる」→ 1 行目の座布団 / captions.json → Cmd+Z 1 手で byte 一致', async () => {
        const original = await captionsRaw();
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="text"]`);
        let changed;
        if (AFTER) changed = await waitRaw(raw => captionOf(raw, 'c-0001')?.text_style?.background?.fit === 'text', 'c-0001 background.fit text');
        else { await sleep(4000); changed = await captionsRaw(); }
        const notifications = await evalOn(cdp, NOTIFICATIONS).catch(() => null);
        const row1TextStyle = captionOf(changed, 'c-0001').text_style ?? null;
        const row2TextStyle = captionOf(changed, 'c-0002').text_style ?? null;
        assert(row2TextStyle === null, `c-0002 text_style changed ${JSON.stringify(row2TextStyle)}`);
        const look = AFTER
            ? await waitFor('text pressed', async () => { const s = await evalOn(cdp, LOOK_STATE); return s.fitPressed?.join() === 'text' ? s : null; }, 20_000)
            : await evalOn(cdp, LOOK_STATE);
        const line1 = await plateAt(0.5, LINE1, d => !AFTER || d.lineWidth < d.captionPlateBoxWidth * 0.5);
        const file1 = await shot(cdp, '02-line1-after-click.png');
        const line2 = await plateAt(1.5, LINE2);
        const file2 = await shot(cdp, '02-line2-after-click.png');
        const line1Px = yellowRun(file1), line2Px = yellowRun(file2);
        assert(ratio(line2) >= 0.98 && ratio(line2) <= 1.02, `line2 ratio ${ratio(line2)}`);
        assert(Math.abs(line2Px / line2.captionPlateBoxWidth - 1) <= 0.02, `line2 pixel ${line2Px}`);
        assert(line1Px < line2.captionPlateBoxWidth * 0.5, `line1 pixel ${line1Px}`);
        const result = {
            captionsChanged: changed !== original, row1TextStyle, row2TextStyle, look, notifications,
            line1: { ...line1, ratioToPlateBox: ratio(line1), pixelYellowRun: line1Px },
            line2: { ...line2, ratioToPlateBox: ratio(line2), pixelYellowRun: line2Px }
        };
        if (changed !== original) {
            await undo(cdp);
            await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo');
            await sleep(800);
            assert(await captionsRaw() === original, 'captions.json changed again after undo');
            result.undo = 'byte-identical after 1 Cmd+Z';
            result.line1AfterUndo = await plateAt(0.5, LINE1, d => !AFTER || d.lineWidth > d.captionPlateBoxWidth * 0.9);
            result.line1AfterUndo.ratioToPlateBox = ratio(result.line1AfterUndo);
            result.lookAfterUndo = await waitFor('look after undo', async () => {
                const s = await evalOn(cdp, LOOK_STATE); return !AFTER || s.fitPressed?.join() === 'frame' ? s : null;
            }, 20_000);
        } else result.undo = 'not needed (captions.json unchanged)';
        return result;
    });

    if (AFTER) await check('3 「文字に合わせる」→「画面幅」→ 1 行目の fit が消える（既定に従う）', async () => {
        const original = await captionsRaw();
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="text"]`);
        await waitRaw(raw => captionOf(raw, 'c-0001')?.text_style?.background?.fit === 'text', 'fit text');
        await waitFor('text pressed', async () => (await evalOn(cdp, LOOK_STATE)).fitPressed?.join() === 'text', 20_000);
        await sleep(600);
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="frame"]`);
        const changed = await waitRaw(raw => { const bg = captionOf(raw, 'c-0001')?.text_style?.background; return !bg || !Object.hasOwn(bg, 'fit'); }, 'fit removed');
        const look = await waitFor('frame pressed', async () => { const s = await evalOn(cdp, LOOK_STATE); return s.fitPressed?.join() === 'frame' ? s : null; }, 20_000);
        const line1 = await plateAt(0.5, LINE1, d => d.lineWidth > d.captionPlateBoxWidth * 0.9);
        await shot(cdp, '03-back-to-default.png');
        return { row1TextStyle: captionOf(changed, 'c-0001').text_style ?? null, byteIdenticalToBefore: changed === original, look, line1: { ...line1, ratioToPlateBox: ratio(line1) } };
    });
    v.close();
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error'; out.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await saveJson(RESULTS, out);
    console.log(JSON.stringify(out, null, 1).slice(0, 10000));
}
