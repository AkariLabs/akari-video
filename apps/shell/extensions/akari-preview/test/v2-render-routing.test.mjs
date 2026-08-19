import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browserSource = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);
const backendSource = readFileSync(
    join(here, '..', 'src', 'node', 'akari-preview-service.ts'),
    'utf8'
);

test('preview z is resolved from normalized track ids, including mixed tracks', () => {
    assert.match(browserSource, /resolveInternalTrackZ/);
    assert.match(browserSource, /trackIdByItem/);
    assert.match(browserSource, /zForTrack\(segment\.trackId\)/);
    assert.doesNotMatch(browserSource, /resolveVisualTrackZ/);
});

test('unbaked telop and filter have concrete preview drawing routes', () => {
    assert.match(browserSource, /rasterizeTelopPreview/);
    assert.doesNotMatch(browserSource, /await this\.previewService\.rasterizeTelopPreview/);
    assert.match(browserSource, /type: 'akari-preview-model-update'/);
    assert.match(backendSource, /--kind', 'telop'/);
    assert.match(backendSource, /process\.env\.npm_node_execpath \|\| 'node'/);
    assert.match(backendSource, /ELECTRON_RUN_AS_NODE: '1'/);
    assert.match(browserSource, /data-akari-filter-id/);
    assert.match(browserSource, /backdropFilter = cssFilterFor/);
});
