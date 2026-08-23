import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveDeferredTelopPlayback } from '../lib/common/deferred-telop-playback.js';

const here = dirname(fileURLToPath(import.meta.url));
const browserSource = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);

const base = {
    active: true,
    bakePending: false,
    mediaReady: true,
    seekPending: false,
    mediaSeeking: false,
    currentTime: 0,
    targetTime: 0,
    playing: true
};

test('焼成前の有効区間は準備中を返す', () => {
    assert.deepEqual(resolveDeferredTelopPlayback({ ...base, bakePending: true }), { phase: 'baking' });
});

test('焼成後の media 読み込みと再同期は準備中とは別状態になる', () => {
    assert.deepEqual(resolveDeferredTelopPlayback({ ...base, mediaReady: false }), { phase: 'loading' });
    assert.deepEqual(
        resolveDeferredTelopPlayback({ ...base, seekPending: true, mediaSeeking: true }),
        { phase: 'syncing' }
    );
});

test('区間途中で ready になったテロップは現在の timeline 時刻へ一度シークする', () => {
    assert.deepEqual(
        resolveDeferredTelopPlayback({ ...base, targetTime: 2.4 }),
        { phase: 'seek', targetTime: 2.4 }
    );
});

test('シーク中に master clock が進んでも追いかけシークを再発行しない', () => {
    assert.deepEqual(
        resolveDeferredTelopPlayback({
            ...base,
            seekPending: true,
            mediaSeeking: true,
            currentTime: 2.4,
            targetTime: 2.55
        }),
        { phase: 'syncing' }
    );
});

test('シーク完了後の小さい遅れはその場で表示し、再生速度で穏やかに吸収する', () => {
    assert.deepEqual(
        resolveDeferredTelopPlayback({ ...base, currentTime: 2.4, targetTime: 2.52 }),
        { phase: 'ready', playbackRate: 1.06 }
    );
});

test('一時停止中は正確なフレームへシークし、到達後は表示する', () => {
    assert.deepEqual(
        resolveDeferredTelopPlayback({ ...base, playing: false, currentTime: 1, targetTime: 1.02 }),
        { phase: 'seek', targetTime: 1.02 }
    );
    assert.deepEqual(
        resolveDeferredTelopPlayback({ ...base, playing: false, currentTime: 1.02, targetTime: 1.02 }),
        { phase: 'ready', playbackRate: 1 }
    );
});

test('区間外ではプレースホルダも動画も非表示にする', () => {
    assert.deepEqual(resolveDeferredTelopPlayback({ ...base, active: false }), { phase: 'inactive' });
});

test('webview は準備中プレースホルダを持ち、deferred ready を通常 model-update で即時反映する', () => {
    assert.match(browserSource, /data-akari-deferred-telop-id/);
    assert.match(browserSource, /テロップを準備中…/);
    assert.match(browserSource, /resolveDeferredTelopPlaybackFn/);
    assert.match(browserSource, /type: 'akari-preview-model-update'/);
    assert.match(browserSource, /layerVideo\.addEventListener\('seeked'/);
});

test('準備中プレースホルダは host が明示した deferred telop の焼成中だけに出る', () => {
    assert.match(browserSource, /deferredTelop: true/);
    assert.match(browserSource, /const deferredTelop = layer\.deferredTelop === true/);
    assert.doesNotMatch(browserSource, /Boolean\(layer\.proxyMissing && layer\.kind === 'baked'\)/);
    assert.match(browserSource, /const showPlaceholder = deferredAction\.phase === 'baking'/);
    assert.doesNotMatch(browserSource, /showPlaceholder = deferredAction\.phase === 'seek'/);
});

test('ready 後の再同期シークは表示済みフレームを隠さない', () => {
    assert.match(
        browserSource,
        /if \(deferredAction\.phase === 'seek'\) \{\s+layerVideo\.style\.display = 'block';/
    );
    assert.match(
        browserSource,
        /if \(deferredAction\.phase === 'syncing'\) \{\s+layerVideo\.style\.display = 'block';/
    );
    assert.match(browserSource, /entry\.deferredHasPresentedFrame = true;/);
});
