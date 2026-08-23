import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    persistCaptionText,
    persistCaptionZone,
    updateCaptionTextSource,
    updateCaptionZoneSource
} from '../lib/common/caption-zone-write.js';

const here = dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const require = createRequire(import.meta.url);
const { lintProjectCandidates } = require('../../../../../packages/edit-store/lib/write-gate.js');

for (const rootShape of ['array', 'object']) {
    test(`caption zone persists after serialization and reload (${rootShape} root)`, () => {
        const cues = [{
            id: 'c-0001', start: 0.3, end: 2, text: '字幕', speaker: null,
            text_style: { color: '#fff', zone: 'bottom' }
        }];
        const root = rootShape === 'array' ? cues : { default_text_style: { size: 38 }, captions: cues };
        const next = updateCaptionZoneSource(JSON.stringify(root), 'c-0001', 'top-right');
        const reloaded = JSON.parse(next);
        const caption = Array.isArray(reloaded) ? reloaded[0] : reloaded.captions[0];
        assert.equal(caption.text_style.zone, 'top-right');
        assert.equal(caption.text_style.color, '#fff');
        assert.equal(caption.text, '字幕');
    });

    test(`caption text update normalizes text and removes only stale derived fields (${rootShape} root)`, () => {
        const cues = [
            {
                id: 'c-0001', start: 0.3, end: 2, text: '編集前', speaker: null,
                sourceRef: null, edited: false, src: 'a',
                words: [{ start: 0.3, end: 0.8, text: '編集前' }],
                display_text: '旧表示', display_fragments: ['旧', '表示'],
                text_style: { color: '#fff', zone: 'bottom' }
            },
            {
                id: 'c-0002', start: 2, end: 4, text: '触らない字幕', speaker: null,
                sourceRef: null, edited: false
            }
        ];
        const root = rootShape === 'array' ? cues : { default_text_style: { size_px: 38 }, captions: cues };
        const expected = structuredClone(root);
        const expectedCues = Array.isArray(expected) ? expected : expected.captions;
        expectedCues[0].text = 'Café';
        delete expectedCues[0].words;
        delete expectedCues[0].display_text;
        delete expectedCues[0].display_fragments;
        const updated = JSON.parse(updateCaptionTextSource(JSON.stringify(root), 'c-0001', '  Cafe\u0301  '));
        assert.deepEqual(updated, expected);
    });

    test(`blank caption text removes only the selected cue (${rootShape} root)`, () => {
        const cues = [
            { id: 'c-0001', start: 0.3, end: 2, text: '削除対象', speaker: null, sourceRef: null, edited: false },
            { id: 'c-0002', start: 2, end: 4, text: '残る字幕', speaker: null, sourceRef: null, edited: false }
        ];
        const root = rootShape === 'array' ? cues : { default_text_style: { size_px: 38 }, captions: cues };
        const reloaded = JSON.parse(updateCaptionTextSource(JSON.stringify(root), 'c-0001', '   '));
        const remaining = Array.isArray(reloaded) ? reloaded : reloaded.captions;
        assert.deepEqual(remaining, [cues[1]]);
        if (!Array.isArray(reloaded)) assert.deepEqual(reloaded.default_text_style, root.default_text_style);
    });
}

test('successful caption write refreshes the webview instead of suppressing its own watcher only', () => {
    const start = handlerSource.indexOf('protected async handleCaptionWrite');
    const end = handlerSource.indexOf('protected isCaptionWriteRequest', start);
    const handler = handlerSource.slice(start, end);
    assert.match(handler, /persistCaptionZone/);
    assert.match(handler, /this\.queueCaptionsUpdate\(widget\)/);
});

test('caption inline edit wiring pauses playback, supports commit/cancel, and guards rerender', () => {
    assert.match(handlerSource, /captionPlate\.addEventListener\('dblclick'/);
    assert.match(handlerSource, /element\.setAttribute\('contenteditable', 'true'\)/);
    assert.match(handlerSource, /if \(isPlaying\) togglePlayback\(\)/);
    assert.match(handlerSource, /event\.key === 'Enter'[\s\S]*commitCaptionEdit\(\)/);
    assert.match(handlerSource, /event\.key === 'Escape'[\s\S]*cancelCaptionEdit\(\)/);
    const renderStart = handlerSource.indexOf('const renderCaption = () => {');
    const renderEnd = handlerSource.indexOf('const renderTransitionPlate =', renderStart);
    const renderCaption = handlerSource.slice(renderStart, renderEnd);
    assert.match(renderCaption, /if \(activeCaptionEdit\) return/);
    assert.match(renderCaption, /caption\.words\.length > 0/);
    assert.doesNotMatch(renderCaption, /caption\.words\.map\([\s\S]*\.join\(/);
});

test('caption zone passes the project lint gate and is written to captions.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caption-zone-write-'));
    const captionsPath = join(root, 'captions.json');
    try {
        await mkdir(join(root, 'assets'));
        await writeFile(join(root, 'assets', 'a.mp4'), 'fixture');
        await writeFile(join(root, 'edit.json'), JSON.stringify({
            version: 2,
            output: { width: 1920, height: 1080, fps: 30 },
            sources: [{ id: 'a', path: 'assets/a.mp4' }],
            tracks: [{
                id: 'v-main', lane: 'visual', items: [
                    { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } }
                ]
            }]
        }, null, 2));
        await writeFile(captionsPath, JSON.stringify([{
            id: 'c-0001', start: 0.3, end: 2, text: '字幕', speaker: null,
            sourceRef: null, edited: false, src: 'a'
        }], null, 2));
        const source = await readFile(captionsPath, 'utf8');
        const result = await persistCaptionZone({
            source,
            captionId: 'c-0001',
            zone: 'top-right',
            lint: candidate => lintProjectCandidates(root, { 'captions.json': candidate }),
            write: candidate => writeFile(captionsPath, candidate, 'utf8')
        });
        assert.equal(result.pass, true, result.errors.join('\n'));
        const [saved] = JSON.parse(await readFile(captionsPath, 'utf8'));
        assert.equal(saved.text_style.zone, 'top-right');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('caption text passes the project lint gate and preserves timing, style, and other cues', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caption-text-write-'));
    const captionsPath = join(root, 'captions.json');
    try {
        await mkdir(join(root, 'assets'));
        await writeFile(join(root, 'assets', 'a.mp4'), 'fixture');
        await writeFile(join(root, 'edit.json'), JSON.stringify({
            version: 2,
            output: { width: 1920, height: 1080, fps: 30 },
            sources: [{ id: 'a', path: 'assets/a.mp4' }],
            tracks: [{
                id: 'v-main', lane: 'visual', items: [
                    { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } }
                ]
            }]
        }, null, 2));
        const original = [
            {
                id: 'c-0001', start: 0.3, end: 2, text: '編集前', speaker: null,
                sourceRef: null, edited: false, src: 'a', text_style: { color: '#ffffff', zone: 'bottom' }
            },
            {
                id: 'c-0002', start: 2, end: 4, text: '触らない字幕', speaker: null,
                sourceRef: null, edited: false, src: 'a'
            }
        ];
        await writeFile(captionsPath, JSON.stringify(original, null, 2));
        const result = await persistCaptionText({
            source: await readFile(captionsPath, 'utf8'),
            captionId: 'c-0001',
            text: '編集後',
            lint: candidate => lintProjectCandidates(root, { 'captions.json': candidate }),
            write: candidate => writeFile(captionsPath, candidate, 'utf8')
        });
        assert.equal(result.pass, true, result.errors.join('\n'));
        const saved = JSON.parse(await readFile(captionsPath, 'utf8'));
        assert.deepEqual(saved, [{ ...original[0], text: '編集後' }, original[1]]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
