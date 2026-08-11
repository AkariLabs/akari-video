import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('raw preview は editUri ゲートより前に現在位置を専用注釈イベントへ流す', async () => {
    const source = await readFile(join(extensionRoot, 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
    const methodStart = source.indexOf('protected forwardPlaybackTick(');
    const methodEnd = source.indexOf('protected isReviewTransportRequest(', methodStart);
    const method = source.slice(methodStart, methodEnd);
    assert.ok(methodStart >= 0 && methodEnd > methodStart);
    assert.ok(method.indexOf("this.forwardRawPreviewAnnotationState(widget, 'playback')") >= 0);
    assert.match(method, /if \(!editUri\) \{[\s\S]*forwardRawPreviewAnnotationState\(widget, 'playback'\)[\s\S]*return;/u);
    assert.match(source, /onDidChangeCurrentWidget[\s\S]*syncRawPreviewAnnotationContext/u);
    assert.match(source, /getCurrentWidget\('main'\)[\s\S]*forwardRawPreviewAnnotationState\(rawWidget, 'focus'\)/u);
});

test('音声ファイルは動画 raw preview ではなく専用 audio open handler の対象である', async () => {
    const source = await readFile(join(extensionRoot, 'src', 'browser', 'akari-audio-open-handler.ts'), 'utf8');
    assert.match(source, /\['\.wav', 'audio\/wav'\]/u);
    assert.match(source, /\['\.mp3', 'audio\/mpeg'\]/u);
    assert.match(source, /export class AkariAudioOpenHandler implements OpenHandler/u);
});
