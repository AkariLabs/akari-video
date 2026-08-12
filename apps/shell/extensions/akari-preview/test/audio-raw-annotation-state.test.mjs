import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('audio raw preview は動画側と同じ注釈状態イベントをフォーカス時に送る', async () => {
    const source = await readFile(join(extensionRoot, 'src', 'browser', 'akari-audio-open-handler.ts'), 'utf8');
    assert.match(source, /RAW_PREVIEW_ANNOTATION_STATE_EVENT\s*=\s*'akari\.preview\.rawAnnotationState'/u);
    assert.match(source, /implements OpenHandler, FrontendApplicationContribution/u);
    assert.match(source, /onDidChangeCurrentWidget[\s\S]*syncAudioAnnotationContext/u);
    assert.match(source, /getCurrentWidget\('main'\)[\s\S]*forwardRawPreviewAnnotationState\(audioWidget, 'focus'\)/u);
});

test('audio raw preview を開くたびにタイムラインのパッシブアタッチを要求する', async () => {
    const source = await readFile(join(extensionRoot, 'src', 'browser', 'akari-audio-open-handler.ts'), 'utf8');
    assert.match(source, /ATTACH_TIMELINE_PASSIVE_COMMAND_ID\s*=\s*'akari\.annotations\.attachPassive'/u);
    const openStart = source.indexOf('async open(');
    const openEnd = source.indexOf('protected attachTimelinePassively(', openStart);
    const openMethod = source.slice(openStart, openEnd);
    assert.ok(openStart >= 0 && openEnd > openStart);
    assert.match(openMethod, /executeCommand\(ATTACH_TIMELINE_PASSIVE_COMMAND_ID\)|this\.attachTimelinePassively\(\)/u);
    assert.match(
        source,
        /protected attachTimelinePassively\(\)[\s\S]*executeCommand\(ATTACH_TIMELINE_PASSIVE_COMMAND_ID\)/u
    );
});

test('audio webview の再生位置をホスト側の注釈状態へ転送する', async () => {
    const source = await readFile(join(extensionRoot, 'src', 'browser', 'akari-audio-open-handler.ts'), 'utf8');
    const configureStart = source.indexOf('protected configureWidget(');
    const configureEnd = source.indexOf('protected forwardAudioPlaybackTick(', configureStart);
    const configureMethod = source.slice(configureStart, configureEnd);
    assert.ok(configureStart >= 0 && configureEnd > configureStart);
    assert.match(configureMethod, /widget\.onMessage\([\s\S]*message\?\.type === 'akari-audio-playback-tick'/u);
    assert.match(source, /forwardAudioPlaybackTick[\s\S]*akariAudioLastKnownTime = time[\s\S]*forwardRawPreviewAnnotationState\(widget, 'playback'\)/u);
    assert.match(source, /const vscode = acquireVsCodeApi\(\);/u);
    assert.match(source, /\['timeupdate', 'play', 'pause', 'seeked'\][\s\S]*addEventListener\(eventName, reportPlaybackTick\)/u);
});
