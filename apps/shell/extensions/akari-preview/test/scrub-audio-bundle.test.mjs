import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const generatedUrl = new URL('../generated/scrub-audio.js', import.meta.url);
const bundleScript = readFileSync(new URL('../scripts/bundle-frame-engine.mjs', import.meta.url), 'utf8');
const copyScript = readFileSync(new URL('../../../resources/scripts/copy-native-helpers.mjs', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
const protocolSource = readFileSync(new URL('../src/common/akari-preview-protocol.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('scrub audio IIFE は preview-server の正本から生成される', () => {
    assert.ok(existsSync(generatedUrl));
    const generated = readFileSync(generatedUrl, 'utf8');
    assert.match(generated.slice(0, 300), /生成物/);
    assert.match(generated.slice(0, 300), /packages\/preview-server\/public\/audio-scrub\.js/);
    const sandbox = {};
    vm.runInNewContext(generated, sandbox);
    assert.equal(typeof sandbox.AkariScrubAudio.createScrubAudioController, 'function');
    assert.deepEqual([...sandbox.AkariScrubAudio.SCRUB_MODES], ['off', 'on']);
    assert.match(bundleScript, /packages', 'preview-server', 'public', 'audio-scrub\.js'/);
    assert.match(bundleScript, /outputDirectory, 'scrub-audio\.js'/);
});

test('packaged copy・service URL・webview script tag が一続きに配線される', () => {
    assert.match(copyScript, /generated', 'scrub-audio\.js'/);
    assert.match(copyScript, /overlayRuntimeDestination, 'scrub-audio\.js'/);
    assert.match(serviceSource, /findScrubAudioBundle/);
    assert.match(serviceSource, /scrubAudioJavaScriptUrl/);
    assert.match(protocolSource, /scrubAudioJavaScriptUrl\?: string/);
    assert.match(handlerSource, /externalScriptTag\(assets\.scrubAudioJavaScriptUrl\)/);
});

test('src と test に scrub 実装の写しを置かない', () => {
    assert.doesNotMatch(handlerSource, /function createScrubAudioController\s*\(/);
    assert.doesNotMatch(handlerSource, /class Mp4AudioTrack/);
    assert.doesNotMatch(serviceSource, /function createScrubAudioController\s*\(/);
    assert.doesNotMatch(serviceSource, /class Mp4AudioTrack/);
});
