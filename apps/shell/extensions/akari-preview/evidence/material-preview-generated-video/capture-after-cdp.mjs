import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safe = value => String(value).replace(/file:\/\/\S+/gu, '[file]')
    .replace(/\/(?:private\/)?tmp\/\S+/gu, '[temporary-path]')
    .replace(/\/Users\/\S+/gu, '[local-path]')
    .replace(/https?:\/\/\S+/gu, '[url]').slice(0, 300);

async function targets(port) {
    return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
}

async function client(target, errors, failures) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let next = 0;
    const pending = new Map();
    const contexts = [];
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
        if (message.method === 'Runtime.executionContextDestroyed') {
            const index = contexts.findIndex(context => context.id === message.params.executionContextId);
            if (index >= 0) contexts.splice(index, 1);
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            errors.push(safe(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')));
        }
        if (message.method === 'Runtime.exceptionThrown') {
            errors.push(safe(message.params.exceptionDetails?.exception?.description
                ?? message.params.exceptionDetails?.text ?? 'webview exception'));
        }
        if (message.method === 'Network.loadingFailed') {
            failures.push({ reason: safe(message.params.errorText), canceled: !!message.params.canceled });
        }
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`CDP ${method} timed out`));
        }, 15_000);
        pending.set(id, message => { clearTimeout(timer); resolve(message); });
        socket.send(JSON.stringify({ id, method, params }));
    });
    try {
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Network.enable');
    } catch (error) {
        socket.close();
        throw error;
    }
    const evaluate = async (expression, contextId) => {
        const response = (await send('Runtime.evaluate', {
            expression, contextId, returnByValue: true, awaitPromise: true
        })).result;
        if (response.exceptionDetails) throw new Error(safe(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text));
        return response.result.value;
    };
    const contextFor = async selector => {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            const tree = (await send('Page.getFrameTree')).result.frameTree;
            const topId = tree.frame.id;
            const frameIds = new Set();
            const visit = node => { frameIds.add(node.frame.id); for (const child of node.childFrames ?? []) visit(child); };
            visit(tree);
            for (const context of [...contexts].reverse()) {
                if (!context.auxData?.isDefault || !frameIds.has(context.auxData.frameId)) continue;
                if (selector && context.auxData.frameId === topId) continue;
                if (!selector && context.auxData.frameId !== topId) continue;
                try {
                    if (!selector || await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`, context.id)) return context.id;
                } catch { /* detached context */ }
            }
            await sleep(200);
        }
        throw new Error(`active context for ${selector} not found`);
    };
    return { send, evaluate, contextFor, close: () => socket.close() };
}

async function waitTarget(port, predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const target = (await targets(port)).find(predicate);
        if (target) return target;
        await sleep(200);
    }
    throw new Error('CDP target not found');
}

const videoState = `(() => {
    const v = document.querySelector('#preview-video');
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
    let pixels = null;
    try { const ctx = canvas.getContext('2d'); ctx.drawImage(v, 0, 0, 4, 4);
        pixels = Array.from(ctx.getImageData(0, 0, 4, 4).data); } catch { /* no frame */ }
    return { currentTime: v.currentTime, paused: v.paused, muted: v.muted,
        volume: v.volume, playbackRate: v.playbackRate, readyState: v.readyState,
        videoWidth: v.videoWidth, videoHeight: v.videoHeight,
        error: v.error?.code ?? null, pixels };
})()`;
const rawAudioState = `(() => {
    const v = document.querySelector('#preview-video');
    const a = document.querySelector('audio[data-akari-raw-sidecar]');
    return { found: !!a, currentTime: a?.currentTime ?? null, paused: a?.paused ?? null,
        muted: a?.muted ?? null, volume: a?.volume ?? null, playbackRate: a?.playbackRate ?? null,
        readyState: a?.readyState ?? null, error: a?.error?.code ?? null,
        webkitAudioDecodedByteCount: a?.webkitAudioDecodedByteCount ?? null,
        capturedAudioTracks: a?.captureStream?.().getAudioTracks().length ?? null,
        timeDifference: a ? Math.abs(a.currentTime - v.currentTime) : null };
})()`;
const signal = `(() => {
    const p = window.__materialAudioProbe, values = new Float32Array(2048);
    p.analyser.getFloatTimeDomainData(values);
    return { contextState: p.context.state, peak: Math.max(...values.map(Math.abs)),
        rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) };
})()`;

export async function captureAfter(port, evidence, ffprobeStreams) {
    const consoleErrors = [], networkFailures = [];
    let main;
    for (let attempt = 0; attempt < 4 && !main; attempt += 1) {
        try {
            main = await client(await waitTarget(port, item => item.type === 'page'), consoleErrors, networkFailures);
        } catch (error) {
            if (attempt === 3) throw error;
            await sleep(1000);
        }
    }
    let inner;
    let contextId;
    try {
        const mainContext = await main.contextFor();
        let materialReady = false;
        for (let attempt = 0; attempt < 150; attempt += 1) {
            materialReady = await main.evaluate(`!!document.querySelector('[data-akari-material-path*="fal-h3-i2v"]')`, mainContext);
            if (materialReady) break;
            await sleep(200);
        }
        if (!materialReady) throw new Error('candidate material card did not load');
        await main.evaluate(`document.querySelector('[data-akari-material-path*="fal-h3-i2v"]')?.click()`, mainContext);
        inner = await client(await waitTarget(port, item => item.type === 'iframe' && item.url.includes('akari-preview')),
            consoleErrors, networkFailures);
        contextId = await inner.contextFor('#preview-video');
        const evaluate = expression => inner.evaluate(expression, contextId);
        let readyAudio;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            readyAudio = await evaluate(rawAudioState);
            if (readyAudio.found && readyAudio.readyState >= 2) break;
            await sleep(500);
        }
        if (!readyAudio?.found || readyAudio.readyState < 2) throw new Error('raw sidecar did not become playable');
        await evaluate(`(() => {
            if (window.__probe?.c && window.__probe?.x) {
                window.__materialAudioProbe = { context: window.__probe.c, analyser: window.__probe.x };
                return window.__probe.c.state;
            }
            const a = document.querySelector('audio[data-akari-raw-sidecar]');
            const context = new AudioContext(), source = context.createMediaElementSource(a);
            const analyser = context.createAnalyser(); analyser.fftSize = 2048;
            source.connect(analyser); analyser.connect(context.destination);
            window.__materialAudioProbe = { context, analyser };
            context.resume(); return context.state;
        })()`);
        // Re-opening an existing material tab can leave it at its natural end.
        await evaluate(`(() => { const v=document.querySelector('#preview-video');
            if (!v.paused) document.querySelector('#play-toggle').click(); v.currentTime=0; return true; })()`);
        await sleep(300);
        const initial = { video: await evaluate(videoState), audio: await evaluate(rawAudioState) };
        const screenshot = await main.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await writeFile(path.join(evidence, 'after-candidate-open.png'), Buffer.from(screenshot.result.data, 'base64'));
        await evaluate(`document.querySelector('#play-toggle').click()`);
        await sleep(1500);
        const playing = { video: await evaluate(videoState), audio: await evaluate(rawAudioState), signal: await evaluate(signal) };
        await evaluate(`document.querySelector('#play-toggle').click()`);
        await sleep(150);
        const paused = { video: await evaluate(videoState), audio: await evaluate(rawAudioState) };
        await evaluate(`document.querySelector('#preview-video').currentTime = 2.5`);
        await sleep(300);
        const seeked = { video: await evaluate(videoState), audio: await evaluate(rawAudioState) };
        await evaluate(`document.querySelector('#play-toggle').click()`);
        await evaluate(`document.querySelector('.rate-preset[data-rate="1.5"]').click()`);
        await sleep(650);
        const rated = { video: await evaluate(videoState), audio: await evaluate(rawAudioState), signal: await evaluate(signal) };
        inner.close(); inner = undefined;

        const image = await openMaterial(main, mainContext, port, 'still.png', 'akari-image', 'img',
            `(() => {const image=document.querySelector('img');return {complete:image.complete,naturalWidth:image.naturalWidth,
                naturalHeight:image.naturalHeight}})()`, consoleErrors, networkFailures);
        const narration = {};
        for (const extension of ['wav', 'mp3']) {
            const item = await openMaterial(main, mainContext, port, `voice.${extension}`, 'akari-audio', 'audio',
                `(() => {const a=document.querySelector('audio');return {currentTime:a.currentTime,paused:a.paused,
                    muted:a.muted,volume:a.volume,readyState:a.readyState,error:a.error?.code??null,
                    capturedAudioTracks:a.captureStream?.().getAudioTracks().length??null}})()`, consoleErrors, networkFailures);
            narration[extension] = item;
        }
        return {
            phase: 'after', ffprobeStreams,
            fixturePaths: {
                candidate_with_meta: 'assets/generated/candidates/frame-7/fal-h3-i2v-1790533291981.mp4',
                image: 'assets/generated/candidates/frame-7/still.png',
                narration_wav: 'assets/generated/narration/voice.wav',
                narration_mp3: 'assets/generated/narration/voice.mp3'
            },
            cases: { candidate_with_meta: { initial, playing, paused, seeked, rated }, image,
                narration_wav: narration.wav, narration_mp3: narration.mp3 },
            consoleErrors, networkFailures
        };
    } finally {
        inner?.close();
        main.close();
    }
}

async function openMaterial(main, mainContext, port, label, targetKind, selector, expression, errors, failures) {
    const mediaUri = await main.evaluate(`(() => {
        const relative = document.querySelector('[data-akari-material-path*=${JSON.stringify(label)}]')?.dataset.akariMaterialPath;
        const root = decodeURIComponent(location.hash.slice(1));
        return relative && root ? new URL('file://' + root.replace(/\\/$/, '') + '/' + relative).toString() : null;
    })()`, mainContext);
    if (!mediaUri) throw new Error(`${label} material card not found`);
    let hash = 2166136261;
    for (let index = 0; index < mediaUri.length; index += 1) {
        hash ^= mediaUri.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    const widgetId = `${targetKind}-${(hash >>> 0).toString(36)}`;
    await main.evaluate(`document.querySelector('[data-akari-material-path*=${JSON.stringify(label)}]')?.click()`, mainContext);
    const inner = await client(await waitTarget(port, item => item.type === 'iframe'
        && item.url.includes(`id=${widgetId}`)), errors, failures);
    try {
        const contextId = await inner.contextFor(selector);
        const evaluate = source => inner.evaluate(source, contextId);
        for (let attempt = 0; attempt < 40; attempt += 1) {
            const current = await evaluate(expression);
            if ((selector === 'img' && current.complete && current.naturalWidth > 0)
                || (selector === 'audio' && current.readyState >= 2)) {
                if (selector === 'img') return current;
                const playAccepted = await evaluate(`document.querySelector('audio').play().then(() => true)`);
                return { initial: current, playAccepted };
            }
            await sleep(250);
        }
        throw new Error(`${label} did not load`);
    } finally {
        inner.close();
    }
}
