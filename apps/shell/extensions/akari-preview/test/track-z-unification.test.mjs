import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

test('all visual media share one stacking context and full-frame boxes pass hit testing through', () => {
    const overlayStageCss = compiled.split('\n').find(line => line.startsWith('#overlay-stage {')) ?? '';
    const captionPlateCss = compiled.split('\n').find(line => line.startsWith('#caption-plate {')) ?? '';
    assert.match(
        compiled,
        /<div id="preview-layers">[\s\S]*id="preview-video"[\s\S]*id="preview-still"[\s\S]*id="overlay-stage"/
    );
    assert.match(overlayStageCss, /pointer-events: none;/);
    assert.doesNotMatch(overlayStageCss, /z-index:/);
    assert.doesNotMatch(captionPlateCss, /z-index:/);
    assert.doesNotMatch(compiled, /2147483647/);
    assert.match(compiled, /layersStage\.addEventListener\('pointerdown'/);
    assert.match(compiled, /layerAlphaAtPoint\(candidateEntry, event\.clientX, event\.clientY\) > 16/);
});

test('preview injects edit-store track order functions and reapplies every visual z incrementally', () => {
    assert.match(compiled, /deriveVisualTrackOrderFn/);
    assert.match(compiled, /resolveVisualTrackZFn/);
    assert.match(compiled, /zForTrack\('cuts'/);
    assert.match(compiled, /zForTrack\('layers'/);
    assert.match(compiled, /zForTrack\('overlays'/);
    assert.match(compiled, /zForTrack\('captions'/);
    const incremental = compiled.slice(compiled.indexOf('const applyIncrementalModel'));
    assert.match(incremental, /rebuildVisualTrackZ\(\)/);
    assert.match(incremental, /applyCutsZIndex\(activeSegment\)/);
    assert.match(incremental, /applyOverlayTracks\(\)/);
});
