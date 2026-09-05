import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const handlerSource = await readFile(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const audioSource = handlerSource.slice(handlerSource.indexOf('    protected async resolveAudioAssets('));
const resolveSource = audioSource.slice(audioSource.indexOf('        const resolveSource = async ('), audioSource.indexOf('        const gainDb ='));

test('resolveSource sends the shared clip FX request while retaining heavy WAV eligibility', () => {
    assert.match(handlerSource, /import \{ AudioClipFx, audioClipFxOf, previewAudioSidecarRequestFor \} from '\.\.\/common\/audio-clip-fx';/);
    assert.match(resolveSource, /trim: \{ inSec: number; outSec\?: number \},\s*clipFx:/);
    assert.match(resolveSource, /const sidecarRequest = previewAudioSidecarRequestFor\(clipFx\)/);
    assert.match(resolveSource, /preparePreviewAudioSidecar\(\{[^]*?\.\.\.sidecarRequest,[^]*?heavyWavOnly: true\s*\}\)/);
    assert.match(audioSource, /clipFx\?: \{\s*speed\?: number;\s*pitch_semitones\?: number;\s*formant\?: 'preserve' \| 'shift';\s*denoise\?: \{ method: 'fft' \| 'nlm'; strength: number \};\s*lowcut_hz\?: number;\s*\}/);
});

test('sfx, narration and bgm requests all adopt clip FX with the corresponding kind', () => {
    assert.match(audioSource, /resolveSource\(item\.path, label, \{[^]*?\}, audioClipFxOf\(item, kind\)\)/);
    assert.match(audioSource, /timed\(audio\.sfx, 'sfx'\)/);
    assert.match(audioSource, /timed\(audio\.narration, 'narration'\)/);
    assert.match(audioSource, /resolveSource\(rawBgm\.path, 'audio\.bgm', \{ inSec: bgmIn \?\? 0 \}, audioClipFxOf\(rawBgm, 'bgm'\)\)/);
});

test('failed FX requests warn even when ineligible and preserve source fallback and cache keys', () => {
    assert.match(resolveSource, /if \(!result\.ok \|\| !result\.stream\) \{\s*if \(sidecarRequest\.clipFx !== undefined \|\| result\.eligible !== false\) \{\s*console\.warn\([^]*?\);\s*\}\s*return \{ src: stream\.url \};/);
    assert.match(resolveSource, /if \(result\.key\) previewAudioKeepKeys\.add\(result\.key\)/);
});
