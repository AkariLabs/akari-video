import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('            const refreshIndicators = () => {');
const end = source.indexOf('\n            window.addEventListener(\'akari-frame-engine-ready\'', start);
assert.ok(start >= 0 && end > start);
const implementation = source.slice(start, end);

function renderIndicators(summary, frameEngineActive = true) {
    const indicatorToggle = { hidden: false, textContent: '', title: '',
        getAttribute: () => 'プレビュー未対応', setAttribute(name, value) { this[name] = value; } };
    const indicatorPopup = { hidden: false, textContent: '' };
    const context = {
        summary, indicatorToggle, indicatorPopup, unavailableIndicatorLabel: 'プレビュー未対応',
        document: { getElementById: () => ({ dataset: { frameEngineActive: String(frameEngineActive) } }) },
        videoFxFailedIndicators: new Set(), adjustCssApproximationActive: false, frameEngineMediaIdle: false,
        INDICATOR_LABELS: { audioApproximation: '音声の注意', chromaKey: 'クロマキー' },
        INDICATOR_GLOSSARY: {},
        t: key => ({
            'preview.previewWindow.canvas.unavailablePrefix': 'ⓘ 未対応 ',
            'preview.previewWindow.canvas.unavailablePreviewPrefix': 'プレビュー未対応: '
        })[key] ?? key
    };
    vm.runInNewContext(`${implementation}\nrefreshIndicators();`, context);
    return { toggle: indicatorToggle, popup: indicatorPopup };
}

test('frame-engine が動いても音素材なしなら未対応表示を出さない', () => {
    const { toggle, popup } = renderIndicators({ indicators: [], hasAudio: false, cuts: [] });
    assert.equal(toggle.hidden, true);
    assert.equal(popup.textContent, '');
});

test('音素材があるときの近似説明は件数に含めず注記に出す', () => {
    const noteOnly = renderIndicators({ indicators: [], hasAudio: true, audio: { sfx: [{ id: 'hit' }] }, cuts: [] });
    assert.equal(noteOnly.toggle.textContent, 'ⓘ');
    assert.equal(noteOnly.toggle['aria-label'], '音声の注意');
    assert.equal(noteOnly.popup.textContent, '音声の注意');
    const mixed = renderIndicators({ indicators: ['chromaKey', 'audioApproximation'], hasAudio: true,
        audio: { bgm: { id: 'bed' } }, cuts: [] });
    assert.equal(mixed.toggle.textContent, 'ⓘ 未対応 1');
    assert.equal(mixed.popup.textContent, 'プレビュー未対応: クロマキー / 音声の注意');
    const noEngine = renderIndicators({ indicators: [], hasAudio: true, audio: { narration: [{ id: 'voice' }] }, cuts: [] }, false);
    assert.equal(noEngine.toggle.hidden, true);
});

test('ホストの summary は解決済み音素材と embedded speech から音の有無を渡す', () => {
    const summary = handlerSource.slice(handlerSource.indexOf('            const audio = await this.resolveAudioAssets('),
        handlerSource.indexOf('            const indicators: string[] = [];') + 850);
    assert.match(summary, /const hasAudio = !!\(audio\?\.bgm[\s\S]*?embeddedSpeech\.length\)/);
    assert.match(handlerSource, /indicators,\s*\.\.\.\(\{ hasAudio \}\),/);
    assert.match(handlerSource, /if \(hasSourceAudio === true\) \{\s*model\.summary = \{ \.\.\.model\.summary, \.\.\.\(\{ hasAudio: true \}\) \};/);
    const expression = handlerSource.match(/const hasAudio = ([\s\S]*?);\s*indicators\.push/)?.[1];
    assert.ok(expression);
    const hasAudio = (audio, embeddedSpeech = []) => vm.runInNewContext(expression, { audio, embeddedSpeech });
    assert.equal(hasAudio(undefined), false);
    assert.equal(hasAudio({ sfx: [] }), false);
    assert.equal(hasAudio({ sfx: [{ id: 'hit' }] }), true);
    assert.equal(hasAudio(undefined, [{ id: 'speech' }]), true);
});

test('同じ代表ソースの in-place 更新だけ音声 probe 結果を summary に引き継ぐ', () => {
    const refresh = handlerSource.slice(handlerSource.indexOf('    protected async refreshPreview('),
        handlerSource.indexOf('    protected async handlePreviewAudioPriority('));
    assert.match(refresh, /akariPreviewHasSourceAudio = hasSourceAudio === true/);
    assert.equal([...refresh.matchAll(/if \(sameSourceHasAudio\) Object\.assign\(summary, \{ hasAudio: true \}\);/g)].length, 2);
    assert.match(refresh, /if \(sameSourceHasAudio\) Object\.assign\(summary, \{ hasAudio: true \}\);[\s\S]*?widget\.sendMessage\(\{ type: 'akari-preview-model-update', summary \}\)/);

    const sourceExpression = refresh.match(/const sameSourceHasAudio = ([\s\S]*?);\s*if \(!forceRebuild/)?.[1];
    assert.ok(sourceExpression);
    const expression = sourceExpression.replace('(widget as PreviewWidgetMarker & { akariPreviewHasSourceAudio?: boolean })', 'widget');
    const uri = value => ({ toString: () => value });
    const isSameAudio = (kind, cachedSource, nextSource, hasAudio) => vm.runInNewContext(expression, {
        kind, widget: { akariPreviewHasSourceAudio: hasAudio, akariPreviewVideoUri: uri(cachedSource) },
        model: { sourceUri: uri(nextSource) }
    });
    assert.equal(isSameAudio('output', 'file:///one.mp4', 'file:///one.mp4', true), true);
    assert.equal(isSameAudio('output', 'file:///one.mp4', 'file:///two.mp4', true), false);
    assert.equal(isSameAudio('output', 'file:///one.mp4', 'file:///one.mp4', false), false);
    assert.equal(isSameAudio('raw', 'file:///one.mp4', 'file:///one.mp4', true), false);
});
