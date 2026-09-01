import assert from 'node:assert/strict';
import test from 'node:test';

import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

test('getOverlayRuntimeAssets は keyframe 補間器を export 無しで runtimeJavaScript に同梱する', async () => {
    const service = new AkariPreviewServiceImpl();
    const assets = await service.getOverlayRuntimeAssets();
    assert.match(assets.runtimeJavaScript, /function interpolateKeyframes\(/);
    assert.match(assets.runtimeJavaScript, /window\.akari\.keyframes = Object\.freeze/);
    assert.match(assets.runtimeJavaScript, /__akariItemKeyframesSoftReload/);
    assert.match(assets.runtimeJavaScript, /nextSignature !== mountedSignature[\s\S]*Promise\.resolve\(mount\(summary\)\)/);
    assert.doesNotMatch(assets.runtimeJavaScript, /export \{/);
    assert.ok(
        assets.runtimeJavaScript.indexOf('function interpolateKeyframes(')
            < assets.runtimeJavaScript.indexOf('function createOverlayRuntime('),
        '補間器は overlay-runtime.js より前に必要です'
    );
    assert.ok(
        assets.runtimeJavaScript.indexOf('function createOverlayRuntime(')
            < assets.runtimeJavaScript.indexOf('__akariItemKeyframesSoftReload'),
        'soft reload adapter は overlay runtime を wrap するため後ろに必要です'
    );
});
