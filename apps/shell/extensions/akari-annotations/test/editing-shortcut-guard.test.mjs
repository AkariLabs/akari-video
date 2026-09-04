import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    isEditableEventTarget,
    isImeCompositionKeydown,
    shouldStopEditableDeletionKeydown
} from 'akari-preview/lib/common/review-tool-mode.js';

const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
const preview = readFileSync(
    join(here, '..', '..', 'akari-preview', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);
const audioDialog = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-audio-keyframe-dialog.ts'),
    'utf8'
);
const recorder = readFileSync(
    join(here, '..', '..', 'akari-preview', 'src', 'browser', 'review-session-recorder.ts'),
    'utf8'
);

test('typing targets share one guard before timeline and preview shortcuts', () => {
    for (const target of [
        { tagName: 'INPUT' },
        { tagName: 'TEXTAREA' },
        { tagName: 'DIV', isContentEditable: true }
    ]) {
        assert.equal(isEditableEventTarget(target), true);
    }
    assert.match(widget, /return isEditableEventTarget\(target as HTMLElement \| null\)/);
    assert.match(widget, /if \(!this\.isAttached \|\| this\.isEditableTarget\(event\.target\) \|\| this\.isEditableTarget\(document\.activeElement\)\) \{\s*return;/);
    assert.match(preview, /const isEditable = \(\$\{isEditableEventTarget\.toString\(\)\}\)/);
    assert.match(preview, /isEditable\(event\.target\)[\s\S]*isEditable\(document\.activeElement\)/);
});

test('inner editable Delete is stopped before Theia can synthesize an iframe keydown', () => {
    assert.equal(isEditableEventTarget({ tagName: 'IFRAME' }), false, 'host-side iframe is not editable');
    const innerStopped = shouldStopEditableDeletionKeydown(
        { tagName: 'SPAN', isContentEditable: true },
        { tagName: 'DIV', isContentEditable: true },
        'Delete', false, false
    );
    const hostDeleteWouldFire = !innerStopped && !isEditableEventTarget({ tagName: 'IFRAME' });
    assert.equal(innerStopped, true);
    assert.equal(hostDeleteWouldFire, false);
    assert.match(
        preview,
        /document\.addEventListener\('keydown',[\s\S]*shouldStopEditableDeletionKeydownFn[\s\S]*event\.stopPropagation\(\)[\s\S]*\}, true\)/
    );
});

// issue #51: 素のキーを取るショートカットは IME 変換中に走ってはいけない。ホスト document 側
// (timeline / dialog / recorder) と webview 側 (preview) の両方に同じ判定を通す。

test('IME composition disarms bare-key shortcuts on every global keydown consumer', () => {
    // タイムライン: window capture のハンドラ先頭。Escape 分岐より前でなければ、変換の取り消しが
    // ドラッグ解除やトリマー離脱に食われる。
    assert.match(
        widget,
        /const keydown = \(event: KeyboardEvent\): void => \{[\s\S]{0,600}?if \(isImeCompositionKeydown\(event\)\) return;[\s\S]{0,400}?this\.flushStripRender\(\);/
    );
    assert.match(widget, /if \(event\.key === 'Escape' && this\.dragState\)/);
    assert.ok(
        widget.indexOf('isImeCompositionKeydown(event)') < widget.indexOf("if (event.key === 'Escape' && this.dragState)"),
        'composition guard must precede every Escape branch'
    );

    // 音量キーフレームダイアログ: Space / Delete / Escape。
    assert.match(audioDialog, /dialogKeydown = \(event: KeyboardEvent\): void => \{[\s\S]{0,300}?if \(isImeCompositionKeydown\(event\)\) return;/);

    // レビュー収録: 1 / 2 / 3 / Escape のツールモード切替。
    assert.match(recorder, /if \(isImeCompositionKeydown\(event\)\) \{\s*return;\s*\}/);

    // プレビュー webview: スペースの再生トグル。転送前のネイティブイベントを自前で弾く。
    assert.match(preview, /const isImeComposing = \(\$\{isImeCompositionKeydown\.toString\(\)\}\)/);
    assert.match(preview, /if \(isImeComposing\(event\)\s*\|\|\s*\(event\.code !== 'Space' && event\.key !== ' '\)/);
});

test('the forwarded-keydown path is covered because Theia drops isComposing but keeps keyCode', () => {
    // plugin-ext pre/main.js は isComposing を積まない -> ホスト側の合成イベントでは常に false。
    const forwarded = { key: ' ', code: 'Space', keyCode: 229, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false };
    assert.equal(forwarded.isComposing, undefined, 'Theia does not forward isComposing');
    assert.equal(isImeCompositionKeydown(forwarded), true, 'keyCode 229 must still disarm the shortcut');

    // 転送イベントの target はホスト側の iframe なので、従来の編集中ガードは素通りする。
    assert.equal(isEditableEventTarget({ tagName: 'IFRAME' }), false);

    // 変換していない通常のスペースは、転送されてきてもショートカットのまま。
    assert.equal(isImeCompositionKeydown({ ...forwarded, keyCode: 32 }), false);
});
