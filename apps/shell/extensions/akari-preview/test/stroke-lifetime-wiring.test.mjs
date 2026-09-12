import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url);

test('webview receives and applies the shared stroke lifetime resolver', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    assert.match(source, /const resolveStrokeLifetimeAlphaFn = \(\$\{resolveStrokeLifetimeAlpha\.toString\(\)\}\);/);
    assert.match(source, /resolveStrokeLifetimeAlphaFn\(item, context, PEN_TUNING\)/);
});

test('completed pen and rect items carry local lifetime metadata', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    assert.match(source, /persistentStrokeItems\.push\(\{ tool: 'pen', points: completed\.points,[\s\S]*?recTEnd: reviewRecNow\(\),[\s\S]*?frame: \{ timelineT: completed\.frameAtStart\.timelineT \}/);
    assert.match(source, /persistentStrokeItems\.push\(\{ tool: 'rect', box: completed\.box,[\s\S]*?recTEnd: reviewRecNow\(\),[\s\S]*?frame: \{ timelineT: completed\.frameAtStart\.timelineT \}/);
});

test('recording stop clears display pools while transport changes resync lifetime', async () => {
    const source = await readFile(sourceUrl, 'utf8');
    assert.match(source, /if \(!reviewRecordingActive && wasRecordingActive\) \{[\s\S]*?persistentStrokeItems = \[\]/);
    assert.match(source, /const updateTransport = \(\) => \{[\s\S]*?syncStrokeLifetime\(\);[\s\S]*?\n            \};/);
});
