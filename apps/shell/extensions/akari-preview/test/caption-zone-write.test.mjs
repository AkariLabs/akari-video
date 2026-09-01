import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    captionGroupPositionFromRects,
    persistCaptionGroupPosition,
    persistCaptionText,
    persistCaptionZone,
    updateCaptionGroupPositionSource,
    updateCaptionGroupZoneSource,
    updateCaptionTextSource,
    updateCaptionZoneSource
} from '../lib/common/caption-zone-write.js';

const here = dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const require = createRequire(import.meta.url);
const { lintProjectCandidates } = require('../../../../../packages/edit-store/lib/write-gate.js');

test('caption group landing switches bc/tc, omits centered x, and snaps the lower edge to 93%', () => {
    const frame = { x: 100, y: 50, width: 1000, height: 500 };
    assert.deepEqual(captionGroupPositionFromRects({
        left: 510, right: 690, top: 400, bottom: 519
    }, frame), {
        anchor: 'bc',
        position: { y: 0.93 }
    });
    assert.deepEqual(captionGroupPositionFromRects({
        left: 180, right: 360, top: 100, bottom: 180
    }, frame), {
        anchor: 'tc',
        position: { x: 0.08, y: 0.1 }
    });
});

test('caption group landing clamps and rounds deterministically to four decimal places', () => {
    const input = {
        plate: { left: 223.45678, right: 423.45678, top: -20, bottom: 333.33333 },
        frame: { x: 100, y: 50, width: 777, height: 333 }
    };
    const first = captionGroupPositionFromRects(input.plate, input.frame);
    const second = captionGroupPositionFromRects(input.plate, input.frame);
    assert.deepEqual(first, { anchor: 'tc', position: { x: 0.1589, y: 0 } });
    assert.deepEqual(second, first);
});

test('group position normalizes an array root and changes only default_text_style', () => {
    const cues = [{
        id: 'c-0001', start: 0, end: 1, text: '一', speaker: null,
        text_style: { zone: 'top-left', color: '#fff', position: { x: 0.2, y: 0.3 } }
    }, {
        id: 'c-0002', start: 1, end: 2, text: '二', speaker: null,
        text_style: { text_anchor: 'tr', zone: 'right' }
    }];
    const result = JSON.parse(updateCaptionGroupPositionSource(JSON.stringify(cues), {
        anchor: 'bc', position: { y: 0.93 }
    }));
    assert.deepEqual(result, {
        captions: cues,
        default_text_style: { text_anchor: 'bc', position: { y: 0.93 } }
    });
});

test('group position deletes default zone while group zone deletes position and text_anchor', () => {
    const root = {
        default_text_style: {
            color: '#fff', zone: 'bottom-right', text_anchor: 'tc', position: { x: 0.2, y: 0.1 }
        },
        captions: [{
            id: 'c-0001', start: 0, end: 1, text: '字幕', speaker: null,
            text_style: { zone: 'left', text_anchor: 'bc', position: { y: 0.8 } }
        }]
    };
    const positioned = JSON.parse(updateCaptionGroupPositionSource(JSON.stringify(root), {
        anchor: 'tc', position: { x: 0.1234, y: 0.2345 }
    }));
    assert.deepEqual(positioned.default_text_style, {
        color: '#fff', text_anchor: 'tc', position: { x: 0.1234, y: 0.2345 }
    });
    assert.deepEqual(positioned.captions, root.captions);

    const zoned = JSON.parse(updateCaptionGroupZoneSource(JSON.stringify(positioned), 'top-right'));
    assert.deepEqual(zoned.default_text_style, { color: '#fff', zone: 'top-right' });
    assert.deepEqual(zoned.captions, root.captions);
});

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
        expectedCues[0].edited = true;
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

test('caption text の 1 語置換は未編集語の words を温存する', () => {
    const source = JSON.stringify([{
        id: 'c-0001', start: 0, end: 3, text: 'alpha beta gamma', speaker: null,
        sourceRef: null, edited: false, style: 'karaoke',
        words: [
            { start: 0.1, end: 0.7, text: 'alpha' },
            { start: 0.8, end: 1.6, text: 'beta' },
            { start: 1.7, end: 2.9, text: 'gamma' }
        ]
    }]);
    const updated = JSON.parse(updateCaptionTextSource(source, 'c-0001', 'alpha delta gamma'))[0];
    assert.deepEqual(updated.words[0], { start: 0.1, end: 0.7, text: 'alpha' });
    assert.deepEqual(updated.words[2], { start: 1.7, end: 2.9, text: 'gamma' });
    assert.equal(updated.words[1].text, 'delta');

    const degraded = JSON.parse(updateCaptionTextSource(source, 'c-0001', 'entirely different meaning'))[0];
    assert.equal(Object.hasOwn(degraded, 'words'), false);
    assert.equal(degraded.style, 'karaoke');
});

test('successful caption write refreshes the webview instead of suppressing its own watcher only', () => {
    const start = handlerSource.indexOf('protected async handleCaptionWrite');
    const end = handlerSource.indexOf('protected isCaptionWriteRequest', start);
    const handler = handlerSource.slice(start, end);
    assert.match(handler, /persistCaptionZone/);
    assert.match(handler, /this\.queueCaptionsUpdate\(widget\)/);
});

test('caption drag follows the visual plate and writes one group position on release', () => {
    assert.match(handlerSource, /captionPlate\.style\.translate = outputDx \+ 'px ' \+ outputDy \+ 'px'/);
    assert.match(handlerSource, /Math\.abs\(centerRatio - 0\.5\) < 0\.03/);
    assert.match(handlerSource, /Math\.abs\(bottomRatio - 0\.93\) < 0\.02/);
    assert.match(handlerSource, /const captionVisualRect =/);
    assert.match(handlerSource, /querySelectorAll\('\.akari-caption__line'\)/);
    assert.match(handlerSource, /\{ groupPosition \}/);
    assert.match(handlerSource, /pendingCaptionDragReload = true/);
    assert.match(handlerSource, /akari-preview-captions-update'[\s\S]*captionPlate\.style\.translate = ''/);
    assert.doesNotMatch(handlerSource, /zoneFromFraction/);
});

test('caption drag converts client geometry to output pixels and display pixels only at the selection box', () => {
    assert.match(handlerSource, /interaction\?\.stageLocalPoint\?\.\(clientX, clientY\)/);
    assert.match(handlerSource, /const topLeft = captionOutputPoint\(clientRect\.left, clientRect\.top\)/);
    assert.match(handlerSource, /left: frameRect\.x \+ rect\.left \* frameScale/);
    assert.match(handlerSource, /const outputFrame = captionOutputFrame\(\)/);
    assert.match(handlerSource, /captionGroupPositionFromRects\([\s\S]{0,120}captionVisualRect\(\),[\s\S]{0,40}outputFrame/);
    assert.doesNotMatch(handlerSource, /captionGroupPositionFromRects\([\s\S]{0,120}captionVisualRect\(\),[\s\S]{0,40}frameRect/);
});

test('caption group badge, drag guides, and inspector zone highlight are wired', () => {
    assert.match(handlerSource, /字幕グループ — 動かすと全字幕が動く/);
    assert.match(handlerSource, /caption-drag-guide-center/);
    assert.match(handlerSource, /caption-drag-guide-bottom/);
    assert.match(handlerSource, /akari-preview-caption-zone-hover/);
    assert.match(handlerSource, /persistCaptionGroupZoneForWidget/);
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

test('caption group position passes the project lint gate and is written to default_text_style', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caption-group-position-write-'));
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
            sourceRef: null, edited: false, src: 'a', text_style: { color: '#ffffff' }
        }], null, 2));
        const result = await persistCaptionGroupPosition({
            source: await readFile(captionsPath, 'utf8'),
            value: { anchor: 'tc', position: { x: 0.125, y: 0.2 } },
            lint: candidate => lintProjectCandidates(root, { 'captions.json': candidate }),
            write: candidate => writeFile(captionsPath, candidate, 'utf8')
        });
        assert.equal(result.pass, true, result.errors.join('\n'));
        const saved = JSON.parse(await readFile(captionsPath, 'utf8'));
        assert.deepEqual(saved.default_text_style, {
            text_anchor: 'tc', position: { x: 0.125, y: 0.2 }
        });
        assert.equal(saved.captions[0].text_style.color, '#ffffff');
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
        assert.deepEqual(saved, [{ ...original[0], text: '編集後', edited: true }, original[1]]);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
