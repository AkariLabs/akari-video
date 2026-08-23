import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerSource = await readFile(
    new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
    'utf8'
);

test('プレビュー音源列挙は tracks 射影だけを読み、audio.master indicator は宣言を維持する', () => {
    assert.match(handlerSource, /projectLegacyAudioView/);
    assert.match(handlerSource, /resolveAudioAssets\(\s*projectLegacyAudioView\(internal\),/);
    assert.doesNotMatch(handlerSource, /resolveAudioAssets\(internal\.declaration\.audio/);
    assert.match(
        handlerSource,
        /isTruthyObject\(\(internal\.declaration\.audio as \{ master\?: unknown \} \| undefined\)\?\.master\)/
    );
});
