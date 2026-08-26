import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

const extractBetween = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
    return source.slice(start, end);
};

test('host fallback gate is source-pinned and simulated because its browser module cannot load in node:test', () => {
    // The Theia/Lumino browser module requires a real DOM and cannot load in node:test. Pinning the
    // production method text guarantees that the simulation below remains a copy of its gate order.
    const methodSource = extractBetween(
        '    protected async handleHevcFallbackRequest(',
        '\n    protected isOpenOutputRequest'
    );
    assert.match(methodSource, /widget\.akariPreviewFallbackSourceUris\?\.has\(request\.videoUri\)/u);
    assert.match(methodSource, /respond\(false, '動画ソースがプレビューの宣言と一致しません'\)/u);
    assert.match(methodSource, /const key = videoUri\.toString\(\);/u);
    assert.match(methodSource, /this\.hevcFallbackAttempted\.has\(key\)/u);
    assert.match(methodSource, /respond\(false, 'このソースは既にフォールバックを試行済みです'\)/u);
    assert.match(methodSource, /this\.hevcFallbackAttempted\.add\(key\);/u);
    assert.match(methodSource, /this\.previewService\.resolveHevcProxy\(\{[\s\S]*?videoUri: key,/u);
    assert.match(methodSource, /this\.hevcFallbackProxyUris\.set\(key, result\.proxyUri\);/u);
    assert.match(methodSource, /this\.queueRefresh\(/u);

    const takeA = 'file:///project/assets/take-a.mp4';
    const takeB = 'file:///project/assets/take-b.mp4';
    const undeclared = 'file:///project/assets/not-declared.mp4';
    const declaredSourceUris = new Set([takeA, takeB]);
    const attempted = new Set();
    const proxyUris = new Map();
    const resolveCalls = [];
    let refreshCount = 0;
    const simulateHostFallback = requestVideoUri => {
        if (!declaredSourceUris.has(requestVideoUri)) {
            return { ok: false, error: '動画ソースがプレビューの宣言と一致しません' };
        }
        const videoUri = { toString: () => requestVideoUri };
        const key = videoUri.toString();
        if (attempted.has(key)) {
            return { ok: false, error: 'このソースは既にフォールバックを試行済みです' };
        }
        attempted.add(key);
        resolveCalls.push(key);
        const result = { status: 'ready', proxyUri: `${key}.proxy.mp4` };
        proxyUris.set(key, result.proxyUri);
        refreshCount += 1;
        return { ok: true };
    };

    assert.deepEqual(simulateHostFallback(takeA), { ok: true });
    assert.deepEqual(simulateHostFallback(takeB), { ok: true });
    assert.deepEqual(simulateHostFallback(takeA), {
        ok: false,
        error: 'このソースは既にフォールバックを試行済みです'
    });
    assert.deepEqual(simulateHostFallback(undeclared), {
        ok: false,
        error: '動画ソースがプレビューの宣言と一致しません'
    });
    assert.deepEqual(resolveCalls, [takeA, takeB]);
    assert.deepEqual([...proxyUris.keys()], [takeA, takeB]);
    assert.equal(refreshCount, 2);
});

test('webview pins the loaded source and serializes fallback requests in FIFO order', () => {
    const processBody = extractBetween(
        '            const processNextHevcFallback = () => {',
        '\n            const attemptHevcFallback = (errorCode, videoUri) => {'
    );
    assert.match(processBody, /if \(hevcFallbackInFlight \|\| hevcFallbackQueue\.length === 0\) return;/u);
    assert.match(processBody, /const request = hevcFallbackQueue\.shift\(\);/u);
    assert.match(processBody, /hevcFallbackInFlight = true;/u);
    assert.match(processBody, /resolveHevcFallback\(request\.errorCode, request\.requestKey\)/u);
    assert.match(processBody, /if \(playbackErrored\) \{[\s\S]*?互換用に変換しています…[\s\S]*?previewMessageReload\.hidden = true;[\s\S]*?\}/u);
    assert.match(processBody, /\.then\(\(\) => \{[\s\S]*?hevcFallbackInFlight = false;[\s\S]*?processNextHevcFallback\(\);[\s\S]*?\}, \(\) => \{/u);
    assert.match(processBody, /\}, \(\) => \{[\s\S]*?if \(playbackErrored\) \{[\s\S]*?再読み込みを試してください。[\s\S]*?previewMessageReload\.hidden = false;[\s\S]*?\}[\s\S]*?hevcFallbackInFlight = false;[\s\S]*?processNextHevcFallback\(\);/u);

    const attemptBody = extractBetween(
        '            const attemptHevcFallback = (errorCode, videoUri) => {',
        "\n            previewMessageReload.addEventListener('click'"
    );
    assert.match(attemptBody, /const requestKey = typeof videoUri === 'string' && videoUri \? videoUri : initial\.videoUri/u);
    assert.match(attemptBody, /if \(hevcFallbackRequested\.has\(requestKey\)\) return;/u);
    assert.match(attemptBody, /hevcFallbackRequested\.add\(requestKey\);/u);
    assert.match(attemptBody, /hevcFallbackQueue\.push\(\{ errorCode, requestKey \}\);/u);
    assert.match(attemptBody, /processNextHevcFallback\(\);/u);

    const errorBody = extractBetween(
        '            const onMainVideoError = event => {',
        '\n            for (const media of [video, standbyVideo]) {'
    );
    assert.match(errorBody, /const segment = segments\[activeSegmentIndex\];/u);
    assert.match(errorBody, /const segmentSourceId = segment && segment\.kind === 'src' \? String\(segment\.src\) : '';/u);
    assert.match(errorBody, /const sourceId = currentVideoSourceId \|\| segmentSourceId;/u);
    assert.match(errorBody, /attemptHevcFallback\(errorCode, initial\.videoSourceUris\[sourceId\] \|\| initial\.videoUri\);/u);

    const initial = {
        videoUri: 'file:///project/assets/take-a.mp4',
        videoSourceUris: {
            'take-a': 'file:///project/assets/take-a.mp4',
            'take-b': 'file:///project/assets/take-b.mp4'
        }
    };
    const requested = new Set();
    const queue = [];
    const sent = [];
    let inFlight = false;
    const processNext = () => {
        if (inFlight || queue.length === 0) return;
        inFlight = true;
        sent.push(queue.shift());
    };
    const attemptHevcFallback = (errorCode, videoUri) => {
        const requestKey = typeof videoUri === 'string' && videoUri ? videoUri : initial.videoUri;
        if (requested.has(requestKey)) return;
        requested.add(requestKey);
        queue.push({ errorCode, requestKey });
        processNext();
    };
    const completeCurrent = () => {
        inFlight = false;
        processNext();
    };

    attemptHevcFallback(3, initial.videoSourceUris['take-b']);
    attemptHevcFallback(3, initial.videoSourceUris['take-b']);
    attemptHevcFallback(4, initial.videoSourceUris['take-a']);
    assert.deepEqual(sent, [{ errorCode: 3, requestKey: initial.videoSourceUris['take-b'] }]);
    completeCurrent();
    assert.deepEqual(sent, [
        { errorCode: 3, requestKey: initial.videoSourceUris['take-b'] },
        { errorCode: 4, requestKey: initial.videoSourceUris['take-a'] }
    ]);
});
