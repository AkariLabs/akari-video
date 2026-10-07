import assert from 'node:assert/strict';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const handlerSource = readHandlerSource();
const here = dirname(fileURLToPath(import.meta.url));
const adapterSource = readFileSync(join(here, '../src/browser/preview-script-host-adapter.ts'), 'utf8');

test('loadedmetadata asks the adapter to lay out only its layer', () => {
    assert.match(handlerSource, /layerVideo\.addEventListener\('loadedmetadata', \(\) => \{\s*position\(\)/u);
    assert.match(handlerSource, /window\.akari\.updateLayerLayout\(layerVideo\)/u);
    const assignment = adapterSource.match(/window\.akari\.updateLayerLayout = media => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(assignment);
    const calls = [];
    const window = { akari: {} };
    new Function('window', 'applyLayerStyleMediaLayout', 'updateStageScale', 'output', assignment)(
        window, media => calls.push(media.dataset.akariLayerId), () => calls.push('all'),
        { width: 1920, height: 1080 });
    window.akari.updateLayerLayout({ dataset: { akariLayerId: 'selected' } });
    assert.deepEqual(calls, ['selected']);
    window.akari.updateLayerLayout();
    assert.deepEqual(calls, ['selected', 'all']);
});

test('host shares one dimension probe Promise for repeated stream URI', async () => {
    const raw = handlerSource.match(/const layerDimensions = \(uri: URI\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(raw);
    const expression = raw.replace('(uri: URI)', '(uri)')
        .replace(/const service = this\.previewService as AkariPreviewService & \{[\s\S]*?\n                    \};/u,
            'const service = this.previewService;');
    assert.doesNotMatch(expression, / as AkariPreviewService/u);
    let probes = 0;
    const service = { probeVideoDimensions: async () => { probes++; return { width: 960, height: 540 }; } };
    const dimensions = new Function('layerDimensionProbes', `${expression}\nreturn layerDimensions;`)
        .call({ previewService: service }, new Map());
    const uri = { toString: () => 'file:///same-video.mp4' };
    assert.deepEqual(await Promise.all([dimensions(uri), dimensions(uri), dimensions(uri)]),
        Array(3).fill({ width: 960, height: 540 }));
    assert.equal(probes, 1);
});
