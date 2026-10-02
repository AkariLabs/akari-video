import { readHandlerSource } from '../../akari-preview/test/helpers/handler-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CAPTION_EFFECT_GROUPS, CAPTION_EFFECT_SPECS, captionEffectAdjustmentKeys,
    captionEffectAdjustmentPatch, captionEffectFromStyle, captionEffectPatch,
    captionEffectTransitionPatch, captionEffectPreviewStyle,
    captionCueOriginalStylePatch } from '../lib/browser/inspector/caption-style-effects.js';
import { createCaptionEffectImageCache, scheduleCaptionEffectImages } from '../lib/browser/inspector/caption-effect-images.js';
import { createCaptionStylePreviewController } from '../../akari-preview/lib/common/caption-style-preview.js';
import { CAPTION_MOTION_COMBOS, captionMotionComboWrites, captionMotionCards, captionTextAnimationCards,
    captionTextAnimationWrite } from '../lib/browser/inspector/caption-motion-cards.js';
import { addInspectorAnimatorTemplate, INSPECTOR_ANIMATOR_TEMPLATES,
    inspectorAnimatorTemplateFor } from '../lib/browser/inspector/animator-fields.js';
import { captionMotionSampleKeyframes, CAPTION_MOTION_PANEL_CSS } from '../lib/browser/inspector/caption-motion-panel.js';

test('効果 28 種は七つの段に収まり、影と光を同時に書ける', () => {
    assert.deepEqual(CAPTION_EFFECT_GROUPS.map(group => group.items.length), [6, 6, 5, 3, 2, 3, 3]);
    const ids = CAPTION_EFFECT_GROUPS.flatMap(group => group.items.map(item => item.id));
    assert.equal(new Set(ids).size, 28);
    for (const id of ids) assert.ok(CAPTION_EFFECT_SPECS[id], id);
    for (const id of ids) {
        const detected = captionEffectFromStyle(captionEffectPatch(id, '#ffffff'));
        assert.equal(detected, id, id);
    }
    const combo = captionEffectPatch('combo-neon-shadow', '#ffffff');
    assert.ok(combo.shadow && combo.glow);
    assert.equal(captionEffectFromStyle(combo), 'combo-neon-shadow');
    for (const [oldId, newId] of [['shadow', 'sh-soft'], ['raised', 'sh-raised'],
        ['neon', 'neon-blue'], ['outline', 'ol-thick']]) {
        assert.ok(ids.includes(newId), oldId);
        const legacy = captionEffectPatch(oldId, '#ffffff');
        const before = JSON.stringify(legacy);
        assert.equal(captionEffectFromStyle(legacy), newId);
        assert.equal(JSON.stringify(legacy), before, '判定は保存済み値を変更しない');
    }
});

test('選んだ効果に関係する調整だけを示す', () => {
    assert.deepEqual(captionEffectAdjustmentKeys('neon-blue'), ['glow.color', 'glow.density', 'glow.spread']);
    assert.deepEqual(captionEffectAdjustmentKeys('ol-thin'), ['stroke.color', 'stroke.widthPx']);
    assert.ok(captionEffectAdjustmentKeys('combo-neon-shadow').includes('shadow.blurPx'));
    assert.ok(captionEffectAdjustmentKeys('combo-neon-shadow').includes('glow.spread'));
    assert.deepEqual(captionEffectAdjustmentPatch({ shadow: { color: '#123456' } }, 'shadow.distancePx', '9'),
        { shadow: { color: '#123456', distancePx: 9 } });
    assert.throws(() => captionEffectAdjustmentPatch({}, 'glow.color', 'red'), /hex|色/u);
    assert.deepEqual(captionEffectAdjustmentKeys('ol-double-black'),
        ['stroke.color', 'stroke.widthPx', 'strokeInner.color', 'strokeInner.widthPx']);
    assert.deepEqual(captionEffectAdjustmentKeys('fill-ocean'),
        ['fillGradient.color0', 'fillGradient.color1', 'fillGradient.angleDeg']);
    assert.deepEqual(captionEffectAdjustmentKeys('ex-gold'),
        ['extrude.depthPx', 'extrude.color', 'extrude.colorEnd', 'extrude.angleDeg']);
    assert.deepEqual(captionEffectAdjustmentPatch({ fillGradient: { colors: ['#111111', '#222222'], angleDeg: 90 } },
        'fillGradient.color1', '#abcdef'), { fillGradient: { colors: ['#111111', '#abcdef'], angleDeg: 90 } });
});

test('色を調整しても七枚の構造と色数に沿ってカードを判定する', () => {
    const sea = { fillGradient: { colors: ['#111111', '#1d4ed8'], angleDeg: 115 } };
    assert.equal(captionEffectFromStyle(sea), 'fill-ocean');
    assert.equal(captionEffectAdjustmentKeys(captionEffectFromStyle(sea))
        .filter(key => key.startsWith('fillGradient.color')).length, sea.fillGradient.colors.length);
    assert.equal(captionEffectFromStyle({ fillGradient: {
        colors: ['#111111', '#facc15', '#22c55e'], angleDeg: 45
    } }), 'fill-rainbow');
    assert.equal(captionEffectFromStyle({ fillGradient: {
        colors: ['#111111', '#f43f5e', '#8b5cf6'], angleDeg: 90
    } }), 'fill-sunset');
    assert.equal(captionEffectFromStyle({ stroke: { color: '#eeeeee', widthPx: 8 },
        strokeInner: { color: '#123456', widthPx: 3 } }), 'ol-double-color');
    assert.equal(captionEffectFromStyle({ stroke: { color: '#222222', widthPx: 9 },
        strokeInner: { color: '#ffffff', widthPx: 3 } }), 'ol-double-black');
    assert.equal(captionEffectFromStyle({ color: '#e5e7eb', extrude: {
        depthPx: 7, color: '#888888', colorEnd: '#334155', angleDeg: 135
    } }), 'ex-silver');
});

test('新しい七枚は別のデータを持ち、旧カードへ戻す一操作で新欄を消す', async () => {
    const ids = ['ol-double-black', 'ol-double-color', 'fill-sunset', 'fill-ocean',
        'fill-rainbow', 'ex-gold', 'ex-silver'];
    assert.equal(new Set(ids.map(id => JSON.stringify(CAPTION_EFFECT_SPECS[id]))).size, 7);
    for (const id of ids) assert.equal(captionEffectFromStyle(captionEffectPatch(id, '#ffffff')), id);
    const current = { fillGradient: { colors: ['#22d3ee', '#1d4ed8'], angleDeg: 115 } };
    assert.equal(captionEffectTransitionPatch('sh-soft', '#ffffff', current).fillGradient, null);
    const source = JSON.stringify([{ id: 'c-0001', text_style: {
        fill_gradient: { colors: ['#22d3ee', '#1d4ed8'], angle_deg: 115 }
    } }]);
    const original = captionCueOriginalStylePatch(source, 'c-0001',
        captionEffectTransitionPatch('sh-soft', '#ffffff', current));
    assert.deepEqual(original.fillGradient, current.fillGradient);
    const hover = captionEffectPreviewStyle({}, captionEffectPatch('fill-ocean', '#ffffff'));
    assert.deepEqual(hover.fill_gradient, { colors: ['#22d3ee', '#1d4ed8'], angle_deg: 115 });
    const controller = createCaptionStylePreviewController(() => ({}), async () => {}, () => {});
    await controller.receive({ captionId: 'c-0001', textStyle: hover });
    assert.deepEqual(controller.resolve({ id: 'c-0001', textStyle: {} }, 'c-0001').textStyle.fill_gradient,
        hover.fill_gradient);
    assert.equal(captionEffectPreviewStyle(current,
        captionEffectTransitionPatch('sh-soft', '#ffffff', current)).fill_gradient, null);
});

test('同じ効果カードの画像は一回だけ描く', () => {
    const calls = [];
    const get = createCaptionEffectImageCache(id => { calls.push(id); return `image:${id}`; });
    assert.equal(get('sh-soft'), get('sh-soft'));
    get('sh-hard'); get('sh-soft');
    assert.deepEqual(calls, ['sh-soft', 'sh-hard']);
});

test('効果画像は最初の段だけ同期描画し、残りをフレームごとに増やす', () => {
    const queue = [];
    const drawn = [];
    scheduleCaptionEffectImages(CAPTION_EFFECT_GROUPS.map(group => group.items),
        item => drawn.push(item.id), callback => queue.push(callback));
    assert.equal(drawn.length, 6);
    while (queue.length) queue.shift()();
    assert.equal(drawn.length, 28);
    assert.deepEqual(drawn.slice(0, 6), CAPTION_EFFECT_GROUPS[0].items.map(item => item.id));
});

test('動きの各段は字幕の animation の席へ書く', () => {
    assert.equal(CAPTION_MOTION_COMBOS.length, 6);
    assert.equal(captionMotionCards('in').length, 10);
    assert.equal(captionMotionCards('loop').length, 5);
    assert.equal(captionTextAnimationCards(false).length, 12);
    assert.equal(captionTextAnimationCards(true).length, 47);
    const request = captionTextAnimationWrite('cue-1', { in: { id: 'fade-up', durationSec: .4 } },
        'loop', 'wobble');
    assert.equal(request.kind, 'caption-style-my-style');
    assert.deepEqual(request.value.parts[0].animation, {
        in: { id: 'fade-up', duration_sec: .4 }, loop: { id: 'wobble' }
    });
    const combo = captionMotionComboWrites('cue-1', undefined, 'smart', 30);
    assert.equal(combo.length, 1);
    assert.equal(combo[0].kind, 'caption-style-my-style');
    assert.deepEqual(Object.keys(combo[0].value.parts[0].animation), ['in', 'out', 'loop']);
});

test('アニメーターのひな形は必要な欄だけを案内する', () => {
    assert.deepEqual(INSPECTOR_ANIMATOR_TEMPLATES.map(item => item.fields.length), [2, 2, 3]);
    for (const template of INSPECTOR_ANIMATOR_TEMPLATES) {
        const [animator] = addInspectorAnimatorTemplate([], template.id);
        assert.equal(inspectorAnimatorTemplateFor(animator)?.id, template.id);
    }
});

test('カードは可視範囲だけループし、プレビューはタイプライターにキャレットを付ける', () => {
    const panel = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
    const preview = readHandlerSource();
    assert.match(panel, /new IntersectionObserver/u);
    assert.match(panel, /animationPlayState = entry\.isIntersecting \? 'running' : 'paused'/u);
    assert.match(panel, /item\.slot === 'out' \? 'reverse'/u);
    assert.match(panel, /card\.dataset\.motionKind = item\.kind/u);
    for (const kind of ['combo', 'slot', 'textanim', 'word-style', 'emphasis']) {
        assert.match(panel, new RegExp(`kind: '${kind}' as const`, 'u'));
    }
    assert.match(panel, /\.akari-inspector-widget button\.akari-caption-motion-card\{/u);
    assert.match(panel, /#b8b8b8 0% 25%,#d5d5d5 0% 50%/u);
    assert.match(preview, /akari-preview-caption-motion-play/u);
    assert.match(preview, /akari-caption-preview-caret/u);
    assert.match(preview, /replay\.slot === 'out' \? 'reverse'/u);
});

test('見本は周期の頭と終わりで表示し、動きの後に静止する', () => {
    const frames = captionMotionSampleKeyframes('from { opacity: 0; } to { opacity: 1; }');
    assert.match(frames, /^0%,20%\{opacity:1;transform:none;clip-path:inset\(0\)\}/u);
    assert.match(frames, /20\.10%\{ opacity: 0; \}/u);
    assert.match(frames, /70%,100%\{opacity:1;transform:none;clip-path:inset\(0\)\}$/u);
    assert.match(CAPTION_MOTION_PANEL_CSS, /\.akari-caption-motion-sample-frame\{[^}]*overflow:hidden/u);
    assert.match(CAPTION_MOTION_PANEL_CSS, /@keyframes akari-motion-type\{0%,20%,70%,100%\{max-width:3em\}/u);
    const panel = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /sample\.style\.animationDelay = `\$\{\(-\(sampleIndex\+\+ % 8\) \* \.17\)/u);
});

test('強調の対象語はテーマ色を使う選択可能なチップ', () => {
    const panel = readFileSync(new URL('../src/browser/inspector/caption-motion-panel.ts', import.meta.url), 'utf8');
    assert.match(panel, /chips\.className = 'akari-caption-motion-words'/u);
    assert.match(panel, /button\.setAttribute\('aria-pressed', String\(index === selected\)\)/u);
    assert.match(CAPTION_MOTION_PANEL_CSS, /\.akari-caption-motion-words button\[aria-pressed="true"\]\{[^}]*var\(--theia-focusBorder/u);
    assert.match(CAPTION_MOTION_PANEL_CSS, /var\(--theia-button-background/u);
});

test('アニメーターの説明は全幅で折り返す', () => {
    const widget = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/browser/style/inspector-widget-style.ts', import.meta.url), 'utf8');
    assert.match(widget, /name: 'animator-explain', className: 'akari-inspector-animator-explain'/u);
    assert.match(css, /\.akari-inspector-animator-explain \{ display: block; \}/u);
    assert.match(css, /\.akari-inspector-animator-explain \.akari-inspector-row-label \{\s*white-space: normal/u);
});

test('ライブラリ widget の activate は検索欄か自分の node に focus する', () => {
    const widget = readFileSync(new URL('../../akari-project/src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
    const activation = widget.slice(widget.indexOf('protected override onActivateRequest(msg: Message): void {'),
        widget.indexOf('protected override onActivateRequest(msg: Message): void {') + 850);
    assert.match(activation, /super\.onActivateRequest\(msg\)/u);
    assert.match(activation, /this\.searchInput\?\.isConnected/u);
    assert.match(activation, /input\.focus\(\)/u);
    assert.match(activation, /document\.activeElement === input && !this\.searchComposing/u);
    assert.match(activation, /this\.node\.tabIndex = -1;\s*this\.node\.focus\(\)/u);
});
