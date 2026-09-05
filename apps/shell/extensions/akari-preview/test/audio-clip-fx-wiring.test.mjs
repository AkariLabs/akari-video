import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerSource = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const audioSource = handlerSource.slice(handlerSource.indexOf('    protected async resolveAudioAssets('));
const resolveSource = audioSource.slice(audioSource.indexOf('        const resolveSource = async ('), audioSource.indexOf('        const gainDb ='));

// main 合流（2026-09-06）: クリップ FX の配線は、非ブロッキングの sidecar 要求
// （requestPreviewAudioSidecar + resolveRegularSidecarPlan）に載せる。heavyWavOnly は読み込み経路から消えた。
test('resolveSource sends the shared clip FX request on the non-blocking sidecar path', () => {
    assert.match(handlerSource, /import \{ AudioClipFx, audioClipFxOf, hasAudioClipFx, previewAudioSidecarRequestFor \} from '\.\.\/common\/audio-clip-fx';/);
    assert.match(resolveSource, /at = 0,\s*clipFx: AudioClipFx = \{\}/);
    assert.match(resolveSource, /resolveRegularSidecarPlan\(\{ \.\.\.trim, hasClipFx: hasAudioClipFx\(clipFx\) \}\)/);
    assert.match(resolveSource, /const sidecarRequest = previewAudioSidecarRequestFor\(clipFx\)/);
    assert.match(resolveSource, /const request: PreviewAudioSidecarRequest = \{[^]*?\.\.\.sidecarRequest,[^]*?format: plan\.format/);
    assert.doesNotMatch(resolveSource, /heavyWavOnly/);
    assert.match(handlerSource, /interface PreviewAudioSidecarRequest \{[^]*?clipFx\?: AudioClipFx;/);
});

test('sfx, narration and bgm requests all adopt clip FX with the corresponding kind', () => {
    assert.match(audioSource, /resolveSource\(item\.path, label, \{[^]*?\}, kind, [^]*?, item\.t, audioClipFxOf\(item, kind\)\)/);
    assert.match(audioSource, /timed\(audio\.sfx, 'sfx'\)/);
    assert.match(audioSource, /timed\(audio\.narration, 'narration'\)/);
    assert.match(audioSource, /resolveSource\(rawBgm\.path, 'audio\.bgm', \{ inSec: bgmIn \?\? 0 \}, 'bgm', 'bgm', 0, audioClipFxOf\(rawBgm, 'bgm'\)\)/);
});

test('FX requests keep source fallback and cache keys on the shared request path', () => {
    assert.match(resolveSource, /if \(!plan\.request\) return \{ src: stream\.url \};/);
    assert.match(resolveSource, /if \(result\.key\) previewAudioKeepKeys\.add\(result\.key\)/);
    assert.match(resolveSource, /return this\.previewAudioSidecarFields\(item, result\)/);
});
