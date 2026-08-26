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

const initial = {
    videoUri: 'file:///project/assets/take-a.mp4',
    videoSourceUris: {
        'take-a': 'file:///project/assets/take-a.mp4',
        'take-b': 'file:///project/assets/take-b.mp4'
    }
};

const createFallbackHarness = (resolver, {
    playbackErrored = true,
    initialMessageText = '',
    initialReloadHidden = true
} = {}) => {
    const requested = new Set();
    const queue = [];
    const sent = [];
    let inFlight = false;
    let inFlightCount = 0;
    let maxInFlight = 0;
    let messageText = initialMessageText;
    let reloadHidden = initialReloadHidden;

    const processNext = () => {
        if (inFlight || queue.length === 0) return;
        const request = queue.shift();
        inFlight = true;
        inFlightCount += 1;
        maxInFlight = Math.max(maxInFlight, inFlightCount);
        if (playbackErrored) {
            messageText = '動画をそのまま再生できませんでした。互換用に変換しています…';
            reloadHidden = true;
        }
        sent.push(request);
        resolver(request.errorCode, request.requestKey).then(() => {
            inFlight = false;
            inFlightCount -= 1;
            processNext();
        }, () => {
            if (playbackErrored) {
                messageText = '動画を再生できませんでした。再読み込みを試してください。';
                reloadHidden = false;
            }
            inFlight = false;
            inFlightCount -= 1;
            processNext();
        });
    };
    const attempt = (errorCode, videoUri) => {
        const requestKey = typeof videoUri === 'string' && videoUri ? videoUri : initial.videoUri;
        if (requested.has(requestKey)) return;
        requested.add(requestKey);
        queue.push({ errorCode, requestKey });
        processNext();
    };

    return {
        attempt,
        sent,
        state: () => ({ inFlightCount, maxInFlight, messageText, reloadHidden })
    };
};

const loadedSourceRequestUri = (segments, activeSegmentIndex, currentVideoSourceId) => {
    const segment = segments[activeSegmentIndex];
    const segmentSourceId = segment && segment.kind === 'src' ? String(segment.src) : '';
    const sourceId = currentVideoSourceId || segmentSourceId;
    return initial.videoSourceUris[sourceId] || initial.videoUri;
};

const legacyActiveSegmentRequestUri = (segments, activeSegmentIndex) => {
    const segment = segments[activeSegmentIndex];
    const sourceId = segment && segment.kind === 'src' ? String(segment.src) : '';
    return initial.videoSourceUris[sourceId] || initial.videoUri;
};

test('main video decode failure uses its loaded source during gap and still segments', () => {
    const errorBody = extractBetween(
        '            const onMainVideoError = event => {',
        '\n            for (const media of [video, standbyVideo]) {'
    );
    assert.match(errorBody, /if \(errorCode === 3 \|\| errorCode === 4\)/u);
    assert.match(errorBody, /if \(media !== video\)/u);
    assert.match(errorBody, /const sourceId = currentVideoSourceId \|\| segmentSourceId;/u);
    assert.match(errorBody, /initial\.videoSourceUris\[sourceId\] \|\| initial\.videoUri/u);

    const gapSegments = [{ kind: 'gap' }];
    const stillSegments = [{ kind: 'src', src: 'poster' }];
    assert.equal(legacyActiveSegmentRequestUri(gapSegments, 0), initial.videoUri);
    assert.equal(legacyActiveSegmentRequestUri(stillSegments, 0), initial.videoUri);
    assert.equal(loadedSourceRequestUri(gapSegments, 0, 'take-b'), initial.videoSourceUris['take-b']);
    assert.equal(loadedSourceRequestUri(stillSegments, 0, 'take-b'), initial.videoSourceUris['take-b']);

    const harness = createFallbackHarness(() => new Promise(() => {}));
    const fireMainError = (errorCode, segments) => {
        if (errorCode === 3 || errorCode === 4) {
            harness.attempt(errorCode, loadedSourceRequestUri(segments, 0, 'take-b'));
        }
    };
    fireMainError(3, gapSegments);
    assert.deepEqual(harness.sent, [{
        errorCode: 3,
        requestKey: initial.videoSourceUris['take-b']
    }]);
});

test('transition preloading requests its inactive source only for decode errors', () => {
    const errorBody = extractBetween(
        "            transitionVideo.addEventListener('error', () => {",
        "\n            audioNoticeDismiss.addEventListener('click'"
    );
    assert.match(errorBody, /const errorCode = transitionVideo\.error \? transitionVideo\.error\.code : 0;/u);
    assert.match(errorBody, /if \(errorCode === 3 \|\| errorCode === 4\)/u);
    assert.match(errorBody, /initial\.videoSourceUris\[currentTransitionVideoSourceId\]/u);
    assert.match(errorBody, /attemptHevcFallback\(errorCode, videoUri\);/u);
    assert.doesNotMatch(errorBody, /showPlaybackError/u);

    const simulate = errorCode => {
        const harness = createFallbackHarness(() => new Promise(() => {}));
        const currentTransitionVideoSourceId = 'take-b';
        if (errorCode === 3 || errorCode === 4) {
            const videoUri = initial.videoSourceUris[currentTransitionVideoSourceId];
            if (typeof videoUri === 'string' && videoUri) harness.attempt(errorCode, videoUri);
        }
        return harness.sent;
    };
    for (const errorCode of [3, 4]) {
        assert.deepEqual(simulate(errorCode), [{
            errorCode,
            requestKey: initial.videoSourceUris['take-b']
        }]);
    }
    for (const errorCode of [1, 2]) assert.deepEqual(simulate(errorCode), []);
});

test('ten simultaneous failures stay single-flight and drain in FIFO order after rejections', async () => {
    const processBody = extractBetween(
        '            const processNextHevcFallback = () => {',
        '\n            const attemptHevcFallback = (errorCode, videoUri) => {'
    );
    assert.match(source, /const hevcFallbackQueue = \[\];[\s\S]*?let hevcFallbackInFlight = false;/u);
    assert.match(processBody, /hevcFallbackInFlight \|\| hevcFallbackQueue\.length === 0/u);
    assert.match(processBody, /hevcFallbackQueue\.shift\(\)/u);
    assert.match(processBody, /hevcFallbackInFlight = true/u);
    assert.match(processBody, /if \(playbackErrored\) \{[\s\S]*?互換用に変換しています…[\s\S]*?previewMessageReload\.hidden = true;/u);
    assert.match(processBody, /\.then\(\(\) => \{[\s\S]*?hevcFallbackInFlight = false;[\s\S]*?processNextHevcFallback\(\);[\s\S]*?\}, \(\) => \{/u);
    assert.match(processBody, /\}, \(\) => \{[\s\S]*?if \(playbackErrored\) \{[\s\S]*?previewMessageReload\.hidden = false;[\s\S]*?\}[\s\S]*?hevcFallbackInFlight = false;[\s\S]*?processNextHevcFallback\(\)/u);

    const pending = [];
    const harness = createFallbackHarness((errorCode, requestKey) => new Promise((resolve, reject) => {
        pending.push({ errorCode, requestKey, resolve, reject });
    }));
    const uris = Array.from({ length: 10 }, (_, index) => `file:///project/assets/take-${index}.mp4`);
    for (const uri of uris) harness.attempt(3, uri);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.state().inFlightCount, 1);

    for (let index = 0; index < uris.length; index += 1) {
        const current = pending.shift();
        assert.equal(current.requestKey, uris[index]);
        current.reject(new Error('simulated refusal'));
        await Promise.resolve();
        assert.ok(harness.state().inFlightCount <= 1);
    }

    assert.deepEqual(harness.sent.map(request => request.requestKey), uris);
    assert.equal(harness.state().maxInFlight, 1);
    assert.equal(harness.state().inFlightCount, 0);
    assert.equal(harness.state().messageText, '動画を再生できませんでした。再読み込みを試してください。');
    assert.equal(harness.state().reloadHidden, false);
});

test('silent transition failure leaves UI untouched and still advances the queue', async () => {
    const pending = [];
    const initialMessageText = '再生中のプレビュー';
    const initialReloadHidden = false;
    const harness = createFallbackHarness((errorCode, requestKey) => new Promise((resolve, reject) => {
        pending.push({ errorCode, requestKey, resolve, reject });
    }), { playbackErrored: false, initialMessageText, initialReloadHidden });

    harness.attempt(3, 'file:///project/assets/take-b.mp4');
    harness.attempt(4, 'file:///project/assets/take-c.mp4');
    assert.equal(harness.sent.length, 1);
    assert.deepEqual(harness.state(), {
        inFlightCount: 1,
        maxInFlight: 1,
        messageText: initialMessageText,
        reloadHidden: initialReloadHidden
    });

    pending.shift().reject(new Error('simulated transition refusal'));
    await Promise.resolve();
    assert.deepEqual(harness.sent.map(request => request.requestKey), [
        'file:///project/assets/take-b.mp4',
        'file:///project/assets/take-c.mp4'
    ]);
    assert.deepEqual(harness.state(), {
        inFlightCount: 1,
        maxInFlight: 1,
        messageText: initialMessageText,
        reloadHidden: initialReloadHidden
    });
});

test('ten successful responses advance FIFO one at a time without overlapping host requests', async () => {
    const pending = [];
    const harness = createFallbackHarness((errorCode, requestKey) => new Promise((resolve, reject) => {
        pending.push({ errorCode, requestKey, resolve, reject });
    }));
    const uris = Array.from({ length: 10 }, (_, index) => `file:///project/assets/success-${index}.mp4`);
    for (const uri of uris) harness.attempt(3, uri);
    assert.equal(harness.sent.length, 1);

    for (let index = 0; index < uris.length; index += 1) {
        const current = pending.shift();
        assert.equal(current.requestKey, uris[index]);
        current.resolve();
        await Promise.resolve();
        assert.ok(harness.state().inFlightCount <= 1);
    }

    assert.deepEqual(harness.sent.map(request => request.requestKey), uris);
    assert.equal(harness.state().maxInFlight, 1);
    assert.equal(harness.state().inFlightCount, 0);
});

test('single-source non-HEVC path still sends only the representative URI for errors 3 or 4', () => {
    const harness = createFallbackHarness(() => new Promise(() => {}));
    const fireSingleSourceError = errorCode => {
        if (errorCode === 3 || errorCode === 4) harness.attempt(errorCode, undefined);
    };
    fireSingleSourceError(1);
    fireSingleSourceError(2);
    assert.deepEqual(harness.sent, []);
    fireSingleSourceError(3);
    fireSingleSourceError(4);
    assert.deepEqual(harness.sent, [{ errorCode: 3, requestKey: initial.videoUri }]);
});
