#!/usr/bin/env node
// AFTER: 台本の見た目タブの「座布団の幅」を実機で確かめる。
//   1 1 行目 → ドック → 見た目タブに「座布団の幅: 文字に合わせる / 画面幅」がある
//   2 「画面幅」→ captions.json の c-0001 に background.fit: "frame" → プレビューの座布団が字幕の枠いっぱい → Cmd+Z 1 手で byte 一致
//   3 「画面幅」→「文字に合わせる」→ c-0001 の background から fit が消える
//   4 座布団の色「なし」→ 幅の 2 択が無効表示
// 使い方: node l1-look.mjs <fixture dir（gen-fixture.mjs の出力）> [--project=p-none] [--port=9479]
import { readFile } from 'node:fs/promises';
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
const PORT = Number(arg('port', 9479));
const PROJECT = path.join(FIXTURE, arg('project', 'p-none'));
const ISO = path.join(os.tmpdir(), 'caption-plate-fit-l1', 'runs', 'look');
const RESULTS = path.join(ROOT, 'results-look-after.json');
const out = { phase: 'after', status: 'running', checks: [], screenshots: [] };
const META = 4;
const DOCK = '.akari-daihon-dock';
const EDIT_URI = `file://${path.join(PROJECT, 'edit.json')}`;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
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
    const file = `after-look-${name}`;
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
const FIT_STATE = `(()=>{const f=document.querySelector('${DOCK} [data-look-field="fit"]');if(!f)return null;return{label:(f.querySelector('label')?.textContent||'').trim(),text:(f.textContent||'').trim(),buttons:[...f.querySelectorAll('[data-look-value]')].map(b=>({value:b.dataset.lookValue,label:(b.textContent||'').trim(),disabled:b.disabled,pressed:b.getAttribute('aria-pressed')}))}})()`;

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
const PLATE_DOM = `(()=>{const px=v=>Math.round(v*100)/100;
 const c=[...document.querySelectorAll('#preview-stage canvas, #preview-stage video')].map(e=>e.getBoundingClientRect()).filter(r=>r.width>50).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
 const plate=[...document.querySelectorAll('.akari-caption__plate')].map(e=>e.getBoundingClientRect()).find(r=>r.width>0);
 const line=[...document.querySelectorAll('.akari-caption__line')].find(l=>l.getBoundingClientRect().width>0);const lr=line?.getBoundingClientRect();
 return{frameWidth:c?px(c.width):null,captionPlateBoxWidth:plate?px(plate.width):null,lineText:line?.textContent??null,lineWidth:lr?px(lr.width):null,lineHeight:lr?px(lr.height):null,
  fitVar:line?getComputedStyle(line).getPropertyValue('--caption-plate-fit').trim()||null:null}})()`;
function redRun(file) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString()).streams[0];
    const W = probe.width, H = probe.height;
    const buf = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    const red = (x, y) => { const i = (y * W + x) * 3; return buf[i] > 180 && buf[i + 1] < 90 && buf[i + 2] < 90; };
    let best = 0;
    for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { if (red(x, y)) { run++; if (run > best) best = run; } else run = 0; } }
    return best;
}
async function seek(cdp, time) {
    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: EDIT_URI, time }));
    await sleep(1500);
}

let session;
try {
    await import('node:fs/promises').then(fs => fs.rm(ISO, { recursive: true, force: true }));
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
    const plateAt05 = async () => {
        await seek(cdp, 0.5);
        return waitFor('caption line 短い', async () => { const d = await v.eval(PLATE_DOM); return d.lineText === '短い' ? d : null; }, 60_000);
    };
    out.previewBefore = await plateAt05();

    await evalOn(cdp, command('akari.daihon.open'));
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=2`, { label: 'daihon rows', timeoutMs: 180_000 });
    await sleep(2000);
    const p = await evalOn(cdp, `(()=>{const r=document.querySelector('.akari-daihon-row[data-caption-id="c-0001"]');r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-10,y:b.top+6}})()`);
    await realClick(cdp, p.x, p.y);
    await waitEval(cdp, `(()=>{const d=document.querySelector(${S(DOCK)});return d&&d.classList.contains('open')})()`, { label: 'dock open', timeoutMs: 15_000 });
    await sleep(400);
    await clickAt(cdp, `${DOCK} [data-dock-tab="look"]`);
    await sleep(600);

    await check('1 見た目タブに「座布団の幅: 文字に合わせる / 画面幅」がある', async () => {
        const fields = await evalOn(cdp, `[...document.querySelectorAll('${DOCK} [data-look-field]')].map(f=>({field:f.dataset.lookField,label:(f.querySelector('label')?.textContent||'').trim()}))`);
        const fit = await evalOn(cdp, FIT_STATE);
        assert(fit, 'fit field missing');
        assert(fit.buttons.map(b => b.label).join() === '文字に合わせる,画面幅', `buttons ${fit.buttons.map(b => b.label)}`);
        assert(fit.buttons.every(b => !b.disabled), 'buttons disabled while cushion is present');
        assert(fit.buttons.find(b => b.value === 'text').pressed === 'true', 'text not pressed initially');
        await shot(cdp, '01-look-tab.png');
        return { fields, fit };
    });

    await check('2 画面幅 → fit: frame → プレビューの座布団が枠いっぱい → Cmd+Z 1 手で byte 一致', async () => {
        const original = await captionsRaw();
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="frame"]`);
        const changed = await waitRaw(raw => captionOf(raw, 'c-0001')?.text_style?.background?.fit === 'frame', 'c-0001 background.fit frame');
        const written = captionOf(changed, 'c-0001').text_style;
        const others = captionOf(changed, 'c-0002').text_style ?? null;
        const fitState = await waitFor('frame pressed', async () => { const s = await evalOn(cdp, FIT_STATE); return s?.buttons.find(b => b.value === 'frame')?.pressed === 'true' ? s : null; }, 20_000);
        const dom = await waitFor('preview plate spans the frame', async () => {
            await seek(cdp, 0.5);
            const d = await v.eval(PLATE_DOM);
            return d.lineText === '短い' && d.lineWidth > d.captionPlateBoxWidth * 0.9 ? d : null;
        }, 60_000);
        const file = await shot(cdp, '02-frame.png');
        const pixelRun = redRun(file);
        const ratioToPlateBox = Math.round(dom.lineWidth / dom.captionPlateBoxWidth * 1000) / 1000;
        assert(Math.abs(ratioToPlateBox - 1) <= 0.02, `line/plate ${ratioToPlateBox}`);
        assert(Math.abs(pixelRun / dom.captionPlateBoxWidth - 1) <= 0.02, `pixel run ${pixelRun} vs plate box ${dom.captionPlateBoxWidth}`);
        await undo(cdp);
        await waitRaw(raw => raw === original, 'captions.json byte-identical after 1 undo');
        await sleep(800);
        assert(await captionsRaw() === original, 'captions.json changed again after undo');
        const back = await waitFor('preview plate back to text width', async () => {
            await seek(cdp, 0.5);
            const d = await v.eval(PLATE_DOM);
            return d.lineText === '短い' && d.lineWidth < d.captionPlateBoxWidth * 0.5 ? d : null;
        }, 60_000);
        return { written, otherRowTextStyle: others, fitState, previewBefore: out.previewBefore, previewFrame: { ...dom, pixelRedRun: pixelRun, ratioToPlateBox }, previewAfterUndo: back, undo: 'byte-identical after 1 Cmd+Z' };
    });

    await check('3 画面幅 → 文字に合わせる → fit が消える', async () => {
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="frame"]`);
        await waitRaw(raw => captionOf(raw, 'c-0001')?.text_style?.background?.fit === 'frame', 'fit frame');
        await sleep(600);
        await clickAt(cdp, `${DOCK} [data-look-field="fit"] [data-look-value="text"]`);
        const changed = await waitRaw(raw => { const bg = captionOf(raw, 'c-0001')?.text_style?.background; return !bg || !Object.hasOwn(bg, 'fit'); }, 'fit removed');
        const fitState = await evalOn(cdp, FIT_STATE);
        await shot(cdp, '03-text.png');
        return { textStyleAfter: captionOf(changed, 'c-0001').text_style ?? null, fitState };
    });

    await check('4 座布団の色「なし」→ 幅の 2 択が無効', async () => {
        await clickAt(cdp, `${DOCK} [data-look-field="background"] [data-look-value="none"]`);
        await waitRaw(raw => captionOf(raw, 'c-0001')?.text_style?.background?.opacity === 0, 'opacity 0');
        let lastState = null;
        const fitState = await waitFor('fit disabled', async () => { const s = await evalOn(cdp, FIT_STATE); lastState = s; return s && s.buttons.every(b => b.disabled) ? s : null; }, 20_000)
            .catch(error => { throw new Error(`${error.message}: ${JSON.stringify(lastState)}`); });
        await shot(cdp, '04-no-cushion.png');
        return { fitState };
    });
    v.close();
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error'; out.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await saveJson(RESULTS, out);
    console.log(JSON.stringify(out, null, 1).slice(0, 8000));
}
