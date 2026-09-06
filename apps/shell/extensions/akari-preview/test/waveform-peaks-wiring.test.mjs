import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('protected async handleWaveformFetch('), source.indexOf('protected isWaveformFetchRequest('));
const responseStart = source.indexOf("if (request.kind !== 'waveform-fetch')");
const response = source.slice(responseStart, source.indexOf('const fitCompositeRect', responseStart));
const aggregate = source.slice(source.indexOf('const aggregateWaveform ='), source.indexOf('const prepareWaveformCanvas ='));
const load = source.slice(source.indexOf('const loadWaveform ='), source.indexOf('const updateWaveformPlayhead ='));

test('64 MiB を超えた素材だけ Node のピーク列へ分岐し、境界値以下は原本を読む', () => {
    assert.match(source, /const WAVEFORM_INLINE_DECODE_LIMIT_BYTES = 64 \* 1024 \* 1024;/u);
    assert.match(handler, /fileService\.resolve\(videoUri, \{ resolveMetadata: true \}\)/u);
    assert.match(handler, /stat\.size > WAVEFORM_INLINE_DECODE_LIMIT_BYTES/u);
    assert.doesNotMatch(handler, />=\s*WAVEFORM_INLINE_DECODE_LIMIT_BYTES/u);
    assert.match(handler, /this\.previewService\.buildWaveformPeaks\(/u);
    assert.match(handler, /workspaceRoots: await this\.currentWorkspaceRoots\(\)/u);
    assert.match(handler, /peaks: result\.peaks/u);
    assert.match(handler, /durationSec: result\.durationSec/u);
    assert.match(handler, /return;\s*\}\s*const content = await this\.fileService\.readFile\(videoUri\);/u);
    assert.match(handler, /dataBase64: this\.toBase64\(content\.value\.buffer\)/u);
    assert.match(handler, /reason\.startsWith\('波形を作れませんでした'\)/u);
    assert.match(handler, /波形を作れませんでした（/u);
});

test('webview はピーク列を atob より先に返し、従来の bytes も包んで返す', () => {
    const peaksBranch = response.indexOf('Array.isArray(message.peaks)');
    assert.ok(peaksBranch >= 0 && peaksBranch < response.indexOf('atob('));
    assert.match(response, /request\.resolve\(\{ peaks: message\.peaks, durationSec: Number\(message\.durationSec\) \|\| 0 \}\);\s*return;/u);
    assert.match(response, /request\.resolve\(\{ bytes: bytes\.buffer \}\)/u);
});

test('ピーク列を状態に保持して再集計し、decodeAudioData は bytes の else 側だけで呼ぶ', () => {
    assert.match(source, /let waveformSourcePeaks = null;/u);
    assert.match(aggregate, /if \(waveformSourcePeaks\)/u);
    assert.match(aggregate, /return \{ peaks, rms, globalMax, rmsMax \};/u);
    assert.match(aggregate, /waveformAudioBuffer\.getChannelData\(0\)/u);
    assert.match(load, /if \(payload && Array\.isArray\(payload\.peaks\)\) \{[^}]*waveformSourcePeaks = Float32Array\.from\(payload\.peaks,[^}]*waveformAudioBuffer = null;\s*\} else \{\s*context = new AudioContext\(\);\s*waveformAudioBuffer = await context\.decodeAudioData\(payload\.bytes\.slice\(0\)\);/u);
    assert.match(load, /catch \(error\) \{[^}]*waveformSourcePeaks = null;/u);
});
