import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after building apps/shell. Install playwright-core in a scratch directory and
// pass its index.mjs through PLAYWRIGHT_CORE_PATH; no repository dependency is added.
const phase = process.argv[2];
assert(['before', 'after'].includes(phase), 'usage: run-l1.mjs before|after');
if (phase === 'before') assert(process.env.PLAYWRIGHT_CORE_PATH, 'PLAYWRIGHT_CORE_PATH is required');
assert(process.env.AKARI_L1_TMP_ROOT, 'AKARI_L1_TMP_ROOT is required');
const chromium = phase === 'before' ? (await import(process.env.PLAYWRIGHT_CORE_PATH)).chromium : undefined;
const evidence = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(evidence, '../../../..');
const template = path.resolve(shell, '../../templates/project-default');
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const port = 9657;
const fixtureRoot = await mkdtemp(path.join(process.env.AKARI_L1_TMP_ROOT, 'material-preview-generated-video-workspace-'));
const isolation = await mkdtemp(path.join(process.env.AKARI_L1_TMP_ROOT, 'material-preview-generated-video-isolation-'));
const project = path.join(fixtureRoot, 'project');
let app;
let browser;
const consoleErrors = [];
const networkFailures = [];

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr?.slice(-500)}`);
    return result.stdout;
}

function safe(message) {
    return String(message).replace(/file:\/\/\S+/g, '[file]')
        .replace(/\/(?:private\/)?tmp\/\S+/g, '[temporary-path]')
        .replace(/\/Users\/\S+/g, '[local-path]')
        .replace(/https?:\/\/\S+/g, '[url]')
        .slice(0, 300);
}

async function freePort() {
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
}

async function fixture() {
    await cp(template, project, { recursive: true });
    const candidates = path.join(project, 'assets/generated/candidates/frame-7');
    const narration = path.join(project, 'assets/generated/narration');
    await mkdir(candidates, { recursive: true });
    await mkdir(narration, { recursive: true });
    const video = path.join(candidates, 'fal-h3-i2v-1790533291981.mp4');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=832x480:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000', '-t', '5.184',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '32000', '-ac', '2', '-y', video]);
    await writeFile(`${video}.meta.json`, '{}\n');
    await cp(video, path.join(project, 'assets/generated/direct.mp4'));
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=832x480:rate=30',
        '-t', '5.184', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
        '-an', '-y', path.join(candidates, 'silent-no-meta.mp4')]);
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=832x480',
        '-frames:v', '1', '-y', path.join(candidates, 'still.png')]);
    for (const extension of ['wav', 'mp3']) {
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
            'sine=frequency=660:sample_rate=32000', '-t', '5', '-ac', '2', '-y',
            path.join(narration, `voice.${extension}`)]);
    }
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries',
        'stream=codec_type,codec_name,profile,width,height,sample_rate,channels', '-of', 'json', video]));
    return probe.streams;
}

async function waitForCdp() {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        if (app.exitCode !== null) throw new Error(`Electron exited: ${app.exitCode}`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (response.ok) return;
        } catch { /* starting */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('CDP did not become ready');
}

async function captureScreen(page, output) {
    try {
        await page.screenshot({ path: output, timeout: 10_000 });
    } catch {
        const session = await page.context().newCDPSession(page);
        try {
            const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            await writeFile(output, Buffer.from(shot.data, 'base64'));
        } finally {
            await session.detach();
        }
    }
}

async function connectInner(kind) {
    let target;
    for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find(item => item.type === 'iframe' && item.url.includes(`akari-${kind}`));
        if (!target) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(target, `${kind} webview target not found`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    const contexts = [];
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
        if (message.method === 'Runtime.exceptionThrown') {
            consoleErrors.push(safe(message.params.exceptionDetails?.text ?? 'webview exception'));
        }
        if (message.method === 'Network.loadingFailed') {
            networkFailures.push({ reason: safe(message.params.errorText), canceled: !!message.params.canceled });
        }
        if (message.id) {
            pending.get(message.id)?.(message);
            pending.delete(message.id);
        }
    };
    const send = (method, params = {}) => new Promise(resolve => {
        const id = ++sequence;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    let context;
    for (let attempt = 0; attempt < 20 && !context; attempt += 1) {
        const tree = (await send('Page.getFrameTree')).result.frameTree;
        context = contexts.find(item => item.auxData?.isDefault && item.auxData.frameId !== tree.frame.id);
        if (!context) await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(context, 'inner active-frame context not found');
    const evaluate = async expression => {
        const response = (await send('Runtime.evaluate', {
            expression, contextId: context.id, returnByValue: true, awaitPromise: true
        })).result;
        if (response.exceptionDetails) throw new Error(safe(response.exceptionDetails.text));
        return response.result.value;
    };
    return { evaluate, close: () => socket.close() };
}

const videoState = `(() => {
    const v = document.querySelector('#preview-video');
    if (!v) return { found: false, message: document.body.innerText.slice(0, 150) };
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    let pixels = null;
    try {
        const ctx = canvas.getContext('2d'); ctx.drawImage(v, 0, 0, 4, 4);
        pixels = Array.from(ctx.getImageData(0, 0, 4, 4).data);
    } catch { /* no decoded frame yet */ }
    return { found: true, currentTime: v.currentTime, paused: v.paused, muted: v.muted,
        volume: v.volume, readyState: v.readyState, error: v.error?.code ?? null,
        videoWidth: v.videoWidth, videoHeight: v.videoHeight,
        capturedAudioTracks: v.captureStream?.().getAudioTracks().length ?? null,
        pixels };
})()`;
const audioSignal = `(() => {
    const probe = window.__materialAudioProbe;
    const values = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(values);
    return { contextState: probe.context.state,
        peak: Math.max(...values.map(Math.abs)),
        rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) };
})()`;
const installAudioProbe = selector => `(() => {
    const media = document.querySelector(${JSON.stringify(selector)});
    const context = new AudioContext();
    const source = context.createMediaElementSource(media);
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    source.connect(analyser); analyser.connect(context.destination);
    window.__materialAudioProbe = { context, analyser };
    return context.resume().then(() => context.state);
})()`;

async function main() {
    await freePort();
    const ffprobeStreams = await fixture();
    const appEnv = { ...process.env,
        AKARI_HOME: path.join(isolation, 'material-preview-generated-video-home'),
        THEIA_CONFIG_DIR: path.join(isolation, 'material-preview-generated-video-config') };
    delete appEnv.ELECTRON_RUN_AS_NODE;
    app = spawn(electron, [shell, project, `--remote-debugging-port=${port}`,
        `--user-data-dir=${path.join(isolation, 'material-preview-generated-video-userdata')}`,
        '--no-sandbox', '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
        env: appEnv,
        stdio: 'ignore'
    });
    await waitForCdp();
    if (phase === 'after') {
        // CDP's version endpoint is ready before Theia's renderer accepts Page.enable.
        await new Promise(resolve => setTimeout(resolve, 10_000));
        const { captureAfter } = await import('./capture-after-cdp.mjs');
        const result = await captureAfter(port, evidence, ffprobeStreams);
        await writeFile(path.join(evidence, 'after.json'), `${JSON.stringify(result, null, 2)}\n`);
        console.log(JSON.stringify({ phase, videoTime: result.cases.candidate_with_meta.playing.video.currentTime,
            audioTime: result.cases.candidate_with_meta.playing.audio.currentTime,
            audioTracks: result.cases.candidate_with_meta.playing.audio.capturedAudioTracks,
            signal: result.cases.candidate_with_meta.playing.signal,
            errors: result.consoleErrors.length, failedRequests: result.networkFailures.length }));
        return;
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120_000 });
    const page = browser.contexts()[0].pages()[0];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(safe(message.text()));
    });
    page.on('requestfailed', request => networkFailures.push({
        reason: safe(request.failure()?.errorText ?? 'unknown'), canceled: false
    }));
    await page.locator('[data-akari-material-path]').filter({ hasText: 'fal-h3-i2v' }).waitFor();
    const results = { phase, ffprobeStreams,
        fixturePaths: {
            candidate_with_meta: 'assets/generated/candidates/frame-7/fal-h3-i2v-1790533291981.mp4',
            direct_copy: 'assets/generated/direct.mp4',
            candidate_without_meta_or_audio: 'assets/generated/candidates/frame-7/silent-no-meta.mp4',
            image: 'assets/generated/candidates/frame-7/still.png',
            narration_wav: 'assets/generated/narration/voice.wav',
            narration_mp3: 'assets/generated/narration/voice.mp3'
        }, cases: {}, consoleErrors, networkFailures };

    for (const [name, label, method] of [
        ['candidate_with_meta', 'fal-h3-i2v', 'click'],
        ['direct_copy', 'direct.mp4', 'click'],
        ['candidate_without_meta_or_audio', 'silent-no-meta', 'click'],
        ['candidate_double_click', 'fal-h3-i2v', 'dblclick']
    ]) {
        await page.locator('[data-akari-material-path]').filter({ hasText: label })[method]();
        await page.waitForTimeout(1200);
        const inner = await connectInner('preview');
        const initial = await inner.evaluate(videoState);
        if (name === 'candidate_with_meta') {
            await captureScreen(page, path.join(evidence, `${phase}-candidate-open.png`));
        }
        await inner.evaluate("document.querySelector('#play-toggle')?.click()");
        await page.waitForTimeout(1300);
        const playing = await inner.evaluate(videoState);
        let signal;
        if (name === 'candidate_with_meta') {
            await inner.evaluate(installAudioProbe('#preview-video'));
            await page.waitForTimeout(250);
            signal = await inner.evaluate(audioSignal);
        }
        results.cases[name] = { initial, playing, ...(signal ? { signal } : {}) };
        inner.close();
    }

    await page.locator('[data-akari-material-path]').filter({ hasText: 'still.png' }).click();
    await page.waitForTimeout(900);
    {
        const inner = await connectInner('image');
        results.cases.image = await inner.evaluate(`(() => {
            const image = document.querySelector('img');
            return { found: !!image, complete: image?.complete, naturalWidth: image?.naturalWidth,
                naturalHeight: image?.naturalHeight };
        })()`);
        inner.close();
    }
    for (const extension of ['wav', 'mp3']) {
        await page.locator('[data-akari-material-path]').filter({ hasText: `voice.${extension}` }).click();
        await page.waitForTimeout(900);
        const inner = await connectInner('audio');
        const state = `(() => { const a = document.querySelector('audio'); return {
            found: !!a, currentTime: a?.currentTime, paused: a?.paused, muted: a?.muted,
            volume: a?.volume, readyState: a?.readyState, error: a?.error?.code ?? null,
            capturedAudioTracks: a?.captureStream?.().getAudioTracks().length ?? null } })()`;
        const initial = await inner.evaluate(state);
        await inner.evaluate(installAudioProbe('audio'));
        await inner.evaluate("document.querySelector('audio')?.play().then(() => true)");
        await page.waitForTimeout(1000);
        results.cases[`narration_${extension}`] = {
            initial, playing: await inner.evaluate(state), signal: await inner.evaluate(audioSignal)
        };
        inner.close();
    }
    await writeFile(path.join(evidence, `${phase}.json`), `${JSON.stringify(results, null, 2)}\n`);
    console.log(JSON.stringify({ phase, cases: Object.keys(results.cases),
        videoTime: results.cases.candidate_with_meta.playing.currentTime,
        capturedAudioTracks: results.cases.candidate_with_meta.playing.capturedAudioTracks,
        errors: consoleErrors.length, failedRequests: networkFailures.length }));
}

try {
    await main();
} finally {
    await browser?.close().catch(() => {});
    if (app?.pid && app.exitCode === null && app.signalCode === null) {
        app.kill('SIGTERM');
        await new Promise(resolve => { app.once('exit', resolve); setTimeout(resolve, 3000); });
        if (app.exitCode === null && app.signalCode === null) {
            app.kill('SIGKILL');
            await new Promise(resolve => { app.once('exit', resolve); setTimeout(resolve, 3000); });
        }
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    await rm(isolation, { recursive: true, force: true });
}
