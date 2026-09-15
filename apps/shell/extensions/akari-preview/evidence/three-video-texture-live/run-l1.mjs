#!/usr/bin/env node
// L1: スマホ 3D（ScreenMaterial に動画 / 静止画）のライブプレビューでのちらつきを実測する。
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const argv = process.argv.slice(2); const argOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const label = argOf('--label') ?? 'run'; const electronBin = argOf('--electron'); const shellDir = argOf('--shell'); const projectSrc = argOf('--project');
const cdpPort = Number(argOf('--port') ?? 9746); const outDir = argOf('--out'); const puppeteer = createRequire(path.join(argOf('--puppeteer-root'), 'package.json'))('puppeteer-core');
const log = []; const record = (step, d = {}) => { log.push({ at: new Date().toISOString(), step, ...d }); console.log(`[${step}]`, JSON.stringify(d).slice(0, 600)); };
const waitFor = async (desc, fn, timeoutMs = 120_000, intervalMs = 300) => { const dl = Date.now() + timeoutMs; let last; while (Date.now() < dl) { try { last = await fn(); if (last) return last; } catch (e) { last = { error: String(e) }; } await sleep(intervalMs); } throw new Error(`timed out: ${desc}: ${JSON.stringify(last)}`); };
const centerOf = (page, expr) => page.evaluate(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const click = async (page, p, n = 1) => { await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y, { clickCount: n, delay: 40 }); };
async function findPreviewFrame(page) { return waitFor('preview frame', async () => { const fs = page.frames().sort((a, b) => Number(b.url().includes('/webview/')) - Number(a.url().includes('/webview/'))); for (const f of fs) { if (await f.evaluate(`Boolean(document.getElementById('preview-stage'))`).catch(() => false)) return f; } return null; }, 300_000, 500); }
async function openEditJson(page) {
    const rowExpr = `document.querySelector('[data-akari-output-path="edit.json"]')`;
    await waitFor('preload 消失', () => page.evaluate(`document.querySelector('.theia-preload') === null`), 300_000);
    await waitFor('edit.json 行', () => centerOf(page, rowExpr), 300_000);
    for (let attempt = 1; attempt <= 4; attempt++) {
        const point = await waitFor('行位置', () => page.evaluate(`(() => { const row = ${rowExpr}; if (!row) return null; const r = row.getBoundingClientRect(); if (r.width <= 0) return null; const x = r.left + r.width / 2, y = r.top + r.height / 2; return document.elementFromPoint(x, y)?.closest('[data-akari-output-path="edit.json"]') === row ? { x, y } : null; })()`), 120_000);
        try { await click(page, point, 2); return await findPreviewFrame(page); } catch (e) { record('click-failed', { attempt, error: String(e) }); }
    }
    throw new Error('edit.json を開けなかった');
}
const seekTo = s => `(async () => { const seek = document.getElementById('seek'); seek.value = String(${s}); seek.dispatchEvent(new Event('input', { bubbles: true })); seek.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 1500)); return Number(seek.value); })()`;
// render() を包んで、描画直後の canvas を毎回コピーし統計を取る（preserveDrawingBuffer=false 対策）
const INSTALL_PROBE = `(() => {
    if (window.__flick) return 'already';
    const state = { samples: {}, prev: {}, pngs: {}, keepPng: false, copies: new WeakMap(), hook: null };
    window.__flick = state;
    const SCALE = 4;
    const sample = (container, t) => {
        state.calls = (state.calls ?? 0) + 1;
        try {
            state.lastContainer = { tag: container.tagName, id: container.dataset?.overlayId, hasCanvas: Boolean(container.querySelector('canvas')), shadow: Boolean(container.shadowRoot), w: container.querySelector('canvas')?.width, h: container.querySelector('canvas')?.height };
            const id = container.dataset.overlayId ?? 'unknown';
            const canvas = container.querySelector('canvas'); if (!canvas || canvas.width < 2) return;
            let copy = state.copies.get(canvas); if (!copy) { copy = document.createElement('canvas'); state.copies.set(canvas, copy); }
            const w = Math.max(1, Math.round(canvas.width / SCALE)), h = Math.max(1, Math.round(canvas.height / SCALE));
            if (copy.width !== w || copy.height !== h) { copy.width = w; copy.height = h; }
            const ctx = copy.getContext('2d', { willReadFrequently: true }); ctx.clearRect(0, 0, w, h); ctx.drawImage(canvas, 0, 0, w, h);
            const d = ctx.getImageData(0, 0, w, h).data; const prev = state.prev[id];
            let lum = 0, n = 0, diff = 0, dn = 0, bright = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] < 16) continue; n++;
                const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lum += l; if (l > 140) bright++;
                if (prev) { const pl = 0.2126 * prev[i] + 0.7152 * prev[i + 1] + 0.0722 * prev[i + 2]; if (prev[i + 3] >= 16) { diff += Math.abs(l - pl); dn++; } }
            }
            state.prev[id] = d;
            const video = document.querySelector('video[data-akari-three-video-texture]');
            (state.samples[id] ??= []).push({ at: performance.now(), t, opaque: n, lum: n ? lum / n : 0, bright, diff: dn ? diff / dn : null,
                video: video ? { ct: video.currentTime, seeking: video.seeking, rs: video.readyState, paused: video.paused } : null });
            if (state.keepPng && (state.pngs[id] ??= []).length < 16) state.pngs[id].push({ t, png: copy.toDataURL('image/png') });
        } catch (e) { (state.errors ??= []).push(String(e)); }
    };
    // ライブ再生の tick は runtimes 登録経由で render を呼ぶため threeRuntime.render の差し替えでは拾えない。
    // draw() の直後に必ず呼ばれる interaction.captureCanvasContent を包む（静止・再生の両経路で共通）。
    const inter = window.akari.interaction; const origCapture = inter?.captureCanvasContent;
    const wrapped = canvas => { try { origCapture?.(canvas); } catch {} const c = canvas.closest('[data-overlay-id]'); if (c) sample(c, Number(document.getElementById('seek')?.value ?? NaN)); };
    try { inter.captureCanvasContent = wrapped; } catch {}
    if (inter && inter.captureCanvasContent === wrapped) { state.hook = 'interaction'; return 'installed:interaction'; }
    try { window.akari.interaction = new Proxy(inter ?? {}, { get: (target, key) => key === 'captureCanvasContent' ? wrapped : target[key] }); } catch {}
    if (window.akari.interaction?.captureCanvasContent === wrapped) { state.hook = 'interaction-proxy'; return 'installed:interaction-proxy'; }
    const rt = window.akari.threeRuntime, inter2 = inter;
    return 'FAILED: frozen=' + Object.isFrozen(rt) + '/' + Object.isFrozen(inter2) + '/' + Object.isFrozen(window.akari);
})()`;
const summarize = samples => Object.fromEntries(Object.entries(samples).map(([id, list]) => {
        const diffs = list.map(s => s.diff).filter(v => v !== null); const lums = list.map(s => s.lum); const sorted = [...diffs].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
        const spikes = diffs.filter(v => v > Math.max(6, med * 3)).length; const seeking = list.filter(s => s.video?.seeking).length;
        const dt = list.length > 1 ? (list[list.length - 1].at - list[0].at) / (list.length - 1) : null;
        return [id, { frames: list.length, meanIntervalMs: dt, lumMin: Math.min(...lums), lumMax: Math.max(...lums), diffMedian: med, diffMax: Math.max(...diffs, 0), spikes, seekingFrames: seeking, first: list.slice(0, 40).map(s => [Number(s.t.toFixed(2)), Number(s.lum.toFixed(1)), s.diff === null ? null : Number(s.diff.toFixed(1)), s.video ? Number(s.video.ct.toFixed(2)) : null, s.video?.seeking ? 1 : 0]) }];
    }));
let electron, browser; const result = { label, at: new Date().toISOString() }; const scratch = await mkdtemp(path.join(tmpdir(), 'akari-phone-l1-'));
try {
    const project = path.join(scratch, 'phone-project'); await cp(projectSrc, project, { recursive: true });
    const userDataDir = path.join(scratch, 'user-data'); await mkdir(userDataDir, { recursive: true }); await mkdir(outDir, { recursive: true });
    const args = [...(shellDir ? [shellDir] : []), project, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
    const chunks = []; const child = spawn(electronBin, args, { cwd: shellDir ?? scratch, env: { ...process.env, THEIA_CONFIG_DIR: userDataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => chunks.push(d)); child.stderr.on('data', d => chunks.push(d)); electron = { child, flush: () => writeFile(path.join(outDir, `${label}-electron.log`), Buffer.concat(chunks)) };
    const version = await waitFor('CDP', async () => { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(5000) }); return r.ok ? r.json() : null; }, 300_000, 500);
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null, protocolTimeout: 600_000 });
    const page = await waitFor('Theia page', async () => { for (const c of await browser.pages()) { if (await c.evaluate(() => document.readyState === 'complete' && Boolean(document.querySelector('.lm-Widget'))).catch(() => false)) return c; } return null; }, 600_000, 500);
    await page.bringToFront();
    const frame = await openEditJson(page); record('preview-frame', { url: frame.url().slice(0, 60) });
    // --- 診断: WebGL のテクスチャ転送を記録（video ソースのみ）
    await frame.evaluate(`(() => {
        if (window.__glLog) return; window.__glLog = [];
        const proto = WebGL2RenderingContext.prototype;
        for (const name of ['texImage2D', 'texSubImage2D', 'texStorage2D']) {
            const orig = proto[name];
            proto[name] = function (...args) {
                const src = args[args.length - 1];
                const r = orig.apply(this, args);
                if (src instanceof HTMLVideoElement || name === 'texStorage2D') {
                    const err = this.getError();
                    window.__glLog.push({ name, at: Math.round(performance.now()), args: args.slice(0, name === 'texStorage2D' ? 5 : 6).map(a => typeof a === 'number' ? a : String(a?.constructor?.name)), video: src instanceof HTMLVideoElement ? { w: src.videoWidth, h: src.videoHeight, rs: src.readyState, seeking: src.seeking, ct: Number(src.currentTime.toFixed(3)) } : null, err });
                }
                return r;
            };
        }
    })()`);
    await frame.evaluate(seekTo(2.0));
    await waitFor('overlay mount', () => frame.evaluate(`document.querySelectorAll('[data-overlay-id]').length >= 2`), 180_000);
    await waitFor('3D ready x2', () => frame.evaluate(`(() => { const cs = Array.from(document.querySelectorAll('[data-overlay-id]')); const st = cs.map(c => window.akari.threeRuntime.inspect(c).status); return st.length >= 2 && st.every(s => s === 'ready') ? st : (st.some(s => s === 'error') ? st : null); })()`), 240_000, 400);
    await sleep(4_000);
    const info = await frame.evaluate(`Array.from(document.querySelectorAll('[data-overlay-id]')).map(c => ({ id: c.dataset.overlayId, ...(({ status, videoTextures, materialOverrides, render }) => ({ status, videoTextures, materialOverrides, render }))(window.akari.threeRuntime.inspect(c)) }))`);
    record('scene-info', { info });
    const diag = await frame.evaluate(`(() => {
        const video = document.querySelector('video[data-akari-three-video-texture]');
        let drawn = null;
        if (video) { const c = document.createElement('canvas'); c.width = 96; c.height = 170; const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0, 96, 170); try { const d = ctx.getImageData(0, 0, 96, 170).data; let nb = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) nb++; drawn = { nonBlack: nb, total: 96 * 170 }; } catch (e) { drawn = { error: String(e).slice(0, 120) }; } }
        const log = window.__glLog ?? [];
        const videoUploads = log.filter(e => e.video); const errors = log.filter(e => e.err && e.err !== 0);
        return { video: video ? { src: video.currentSrc.slice(0, 80), w: video.videoWidth, h: video.videoHeight, rs: video.readyState, seeking: video.seeking, ct: video.currentTime, paused: video.paused, error: video.error?.code ?? null, networkState: video.networkState } : null, drawn,
            glCalls: log.length, videoUploads: videoUploads.length, uploadsWithoutFrame: videoUploads.filter(e => e.video.rs < 2).length, texStorage: log.filter(e => e.name === 'texStorage2D').slice(0, 6), firstVideoUploads: videoUploads.slice(0, 5), lastVideoUploads: videoUploads.slice(-3), errors: errors.slice(0, 5) };
    })()`);
    record('diag', diag);

    record('probe', { r: await frame.evaluate(INSTALL_PROBE) });
    // (1) 静止: 同じ時刻を 24 回描いて、絵が変わるかを見る
    await frame.evaluate(`(() => { const S = window.__flick; S.samples = {}; S.prev = {}; for (const c of document.querySelectorAll('[data-overlay-id]')) for (let i = 0; i < 24; i++) window.akari.threeRuntime.render(c, 1.0, { syncVideos: true, maxRenderSize: 720 }); })()`);
    const rawStatic = await frame.evaluate(`JSON.stringify(window.__flick.samples)`);
    record('static-raw', { type: typeof rawStatic, len: rawStatic?.length, head: String(rawStatic).slice(0, 300) });
    const staticSamples = JSON.parse(rawStatic);
    record('static-parsed', { keys: Object.keys(staticSamples), summ: JSON.stringify(summarize(staticSamples)).slice(0, 300) });
    record('static-keys', { keys: await frame.evaluate(`Object.keys(window.__flick.samples).join(',') + ' / n=' + Object.values(window.__flick.samples).map(l => l.length).join(',')`) });
    record('probe-diag', await frame.evaluate(`({ calls: window.__flick.calls, last: window.__flick.lastContainer, errors: window.__flick.errors, hook: window.__flick.hook, containers: Array.from(document.querySelectorAll('[data-overlay-id]')).map(c => ({ id: c.dataset.overlayId, canvases: c.querySelectorAll('canvas').length, w: c.querySelector('canvas')?.width })) })`));
    // (2) 再生: 3.5 秒間の描画列を取る
    await frame.evaluate(`(() => { const S = window.__flick; S.samples = {}; S.prev = {}; S.pngs = {}; S.keepPng = true; })()`);
    await frame.evaluate(`(() => { if (window.__ticks) return; window.__ticks = []; const rt = window.akari.runtime; const orig = rt.tick; rt.tick = function (t, playing) { window.__ticks.push([Math.round(performance.now()), Number(t), playing ? 1 : 0]); return orig.call(this, t, playing); }; })()`);
    await frame.evaluate(`window.__ticks.length = 0`);
    await frame.evaluate(`document.getElementById('play-toggle').click()`);
    await sleep(6_000);
    await page.screenshot({ path: path.join(outDir, `${label}-playing.png`) });
    await frame.evaluate(`document.getElementById('play-toggle').click()`);
    await sleep(500);
    const ticks = JSON.parse(await frame.evaluate(`JSON.stringify(window.__ticks)`));
    result.ticks = ticks;
    const play = JSON.parse(await frame.evaluate(`JSON.stringify((() => { const S = window.__flick; const out = { samples: S.samples, errors: S.errors ?? [], pngs: {} }; for (const [id, list] of Object.entries(S.pngs)) out.pngs[id] = list; return out; })())`));
    for (const [id, list] of Object.entries(play.pngs)) { for (const [i, e] of list.entries()) await writeFile(path.join(outDir, `${label}-${id}-play-${String(i).padStart(2, '0')}-t${e.t.toFixed(2)}.png`), Buffer.from(e.png.split(',')[1], 'base64')); }
    delete play.pngs;

    result.static = summarize(staticSamples); result.play = summarize(play.samples); result.playSamples = play.samples; result.staticSamples = staticSamples; result.playErrors = play.errors; result.info = info; result.ok = true;
    record('summary', { static: result.static, play: result.play });
} catch (e) { result.ok = false; result.error = String(e?.stack ?? e); record('FAILED', { error: result.error }); }
finally { try { await browser?.disconnect(); } catch {} if (electron) { try { await electron.flush(); } catch {} try { electron.child.kill('SIGTERM'); } catch {} const dl = Date.now() + 30_000; while (electron.child.exitCode === null && electron.child.signalCode === null && Date.now() < dl) await sleep(200); try { electron.child.kill('SIGKILL'); } catch {} } await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
result.log = log; await writeFile(path.join(outDir, `${label}-results.json`), `${JSON.stringify(result, null, 2)}\n`); process.exit(result.ok ? 0 : 1);
