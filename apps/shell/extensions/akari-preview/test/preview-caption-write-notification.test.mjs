import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { previewCaptionWrite } from '../lib/common/preview-caption-write.js';

const host = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('caption write notification carries the exact before and after bytes', () => {
    const before = '{"captions":[]}\r\n';
    const after = '{"captions": [ ]}\n';
    assert.deepEqual(previewCaptionWrite('file:///project/edit.json', 'file:///project/captions.json', before, after, '字幕を移動'), {
        editUri: 'file:///project/edit.json',
        captionsUri: 'file:///project/captions.json',
        before,
        after,
        label: '字幕を移動'
    });
    assert.equal(previewCaptionWrite('edit', 'captions', before, before, '字幕を移動'), undefined);
});

test('both host caption persistence paths notify after successful writes', () => {
    const captionWrite = host.slice(host.indexOf('protected async handleCaptionWrite'), host.indexOf('protected isCaptionWriteRequest'));
    const zonePreset = host.slice(host.indexOf('protected async persistCaptionGroupZoneForWidget'), host.indexOf('protected isLayerWriteRequest'));
    for (const path of [captionWrite, zonePreset]) {
        assert.match(path, /await this\.fileService\.writeFile\(captionsUri, BinaryBuffer\.fromString\(candidateText\)\);\s*writtenText = candidateText/);
        assert.match(path, /this\.queueCaptionsUpdate\(widget\);\s*if \(writtenText !== undefined\) \{\s*this\.notifyCaptionWrite\(/);
    }
});
