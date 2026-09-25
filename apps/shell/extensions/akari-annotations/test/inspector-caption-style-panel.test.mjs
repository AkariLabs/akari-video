import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { composeInspectorSections } from '../lib/browser/inspector/section-model.js';
import { filterInspectorSoloSections } from '../lib/browser/inspector/solo-model.js';
import { captionRunRows } from '../lib/browser/inspector/caption-run-rows.js';
import { parseCaptions } from '@akari-video/edit-store';
import {
    CAPTION_BACKGROUND_ON_OPACITY, CAPTION_OUTLINE_WIDTH_PX,
    captionEffectFromWidth, captionEffectWrites, captionEffectFromStyle, captionEffectPatch,
    captionEffectColorPatch, captionEffectStrength, captionEffectStrengthPatch,
    captionPresetAwareStylePatch, resolveCaptionRevealField
} from '../lib/browser/inspector/caption-style-effects.js';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const contribution = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const companionFocus = readFileSync(new URL(
    '../../../../../packages/akari-vibe/live/companion/inspector-focus.mjs', import.meta.url
), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const functions = [
    'formatTimestamp', 'formatDurationSeconds', 'orDash', 'captionStyleDisplayValue',
    'isCaptionHexColor', 'effectiveCaptionBackgroundOpacity', 'CAPTION_SECTIONS',
    'commonCaptionValue', 'MULTI_CAPTION_SECTIONS', 'MOTION_EMPTY_SECTION'
];
const declarations = functions.map(name => {
    const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === name);
    assert.ok(node, name);
    return node.getText(ast);
});
for (const name of ['CAPTION_STYLE_DEFAULTS', 'CAPTION_PLATE_CAPSULE_HALF_HEIGHT_EM']) {
    const node = ast.statements.find(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
    assert.ok(node, name);
    declarations.push(node.getText(ast));
}
const code = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const { captionSections, multiCaptionSections } = new Function(
    'composeInspectorSections', 'CAPTION_ZONES', 'CAPTION_BACKGROUND_ON_OPACITY',
    'captionEffectFromStyle', 'captionEffectPatch', 'captionEffectColorPatch',
    'captionEffectStrength', 'captionEffectStrengthPatch', 'captionRunRows',
    `${code}\nreturn { captionSections: CAPTION_SECTIONS, multiCaptionSections: MULTI_CAPTION_SECTIONS };`
)(composeInspectorSections, ['top', 'middle', 'bottom'], CAPTION_BACKGROUND_ON_OPACITY,
    captionEffectFromStyle, captionEffectPatch, captionEffectColorPatch,
    captionEffectStrength, captionEffectStrengthPatch, captionRunRows);

const caption = (id, extra = {}) => ({
    kind: 'caption', id, text: '字幕', sourceStart: 0, sourceEnd: 2, ...extra
});
const cards = sections => sections.filter(section => section.id === 'style' || section.id.startsWith('style:'));
const field = (sections, name) => sections.flatMap(section => section.fields).find(item => item.name === name);

test('袋がない字幕の動きタブは次の操作を案内する', () => {
    const section = captionSections(caption('plain'), async () => ({ ok: true }))
        .find(section => section.id === 'motion-empty');
    assert.equal(section.fields[0].getValue(), '字幕の動きは、字幕をまとめた袋を置くと設定できます');
});

test('字幕の全種類と複数選択に同じ五枚のスタイルカードを出す', () => {
    for (const snapshot of [
        caption('spoken'),
        caption('placed', { timeDomain: 'output' }),
        caption('preset', { stylePreset: 'sample', effectiveTextStyle: { sizePx: 56 } })
    ]) {
        assert.deepEqual(cards(captionSections(snapshot, async () => ({ ok: true }))).map(section => section.label),
            ['文字', '縁取り', '座布団', '効果', '位置']);
    }
    assert.deepEqual(cards(multiCaptionSections([caption('one'), caption('two')],
        async () => ({ ok: true }), {})).map(section => section.label),
        ['文字', '縁取り', '座布団', '効果', '位置']);
    assert.match(field(captionSections(caption('plain'), async () => ({ ok: true })),
        'caption-size').getValue(), /（既定）/u);
    const plain = captionSections(caption('plain'), async () => ({ ok: true }));
    assert.equal(field(plain, 'caption-font-weight').getValue(), '700（既定）');
    assert.equal(field(plain, 'caption-font-weight').getEditValue(), '700');
    assert.equal(field(plain, 'caption-line-height').getValue(), '1.42（既定）');
    assert.equal(field(plain, 'caption-letter-spacing').getValue(), '0（既定）');
    assert.match(source, /\.akari-caption-effect-choices\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
    assert.match(source, /case 'caption':\s+sections = CAPTION_SECTIONS/u);
    assert.match(source, /sections = MULTI_CAPTION_SECTIONS/u);
});

test('保存した runs が実際の文字カードに並び、選択と外すを接続する', async () => {
    const parsed = parseCaptions(JSON.stringify({ captions: [{ id: 'c-0001', start: 0, end: 2,
        text: 'これは最高です', display_text: 'これは最高です', speaker: null, sourceRef: null,
        edited: true, runs: [{ from: 3, to: 5, role: 'emphasis', style: { color: '#f26666' } }] }] }));
    const current = caption('c-0001', {
        text: parsed.captions[0].text, displayText: parsed.captions[0].displayText,
        runs: parsed.captions[0].runs
    });
    const writes = [];
    const row = field(captionSections(current, async request => {
        writes.push(request); return { ok: true };
    }), 'caption-run-0');
    assert.equal(row.actions[0].label, '4〜5文字目 「最高」 強調');
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const events = [];
    try {
        globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
        globalThis.window = { dispatchEvent: event => events.push(event) };
        await row.actions[0].action(current);
    } finally {
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
    }
    assert.deepEqual(events.map(event => [event.type, event.detail]), [[
        'akari.preview.selectCaptionRun', { captionId: 'c-0001', from: 3, to: 5 }
    ]]);
    await row.actions[1].action(current);
    assert.deepEqual(writes, [{ kind: 'caption-run-remove', id: 'c-0001', index: 0 }]);
});

test('単体と複数選択の各項目を既存 requestWrite kind に送る', async () => {
    for (const multi of [false, true]) {
        const writes = [];
        const snapshots = [caption('one'), caption('two')];
        const sections = multi
            ? multiCaptionSections(snapshots, async request => { writes.push(request); return { ok: true }; }, {})
            : captionSections(snapshots[0], async request => { writes.push(request); return { ok: true }; });
        for (const [name, value, kind] of [
            ['caption-color', '#123456', 'caption-style-color'],
            ['caption-size', '48', 'caption-style-size'],
            ['caption-font-weight', '700', 'caption-style-font-weight'],
            ['caption-line-height', '1.5', 'caption-style-line-height'],
            ['caption-letter-spacing', '0.05', 'caption-style-letter-spacing'],
            ['caption-stroke-color', '#112233', 'caption-style-stroke-color'],
            ['caption-stroke-width', '4.5', 'caption-style-stroke-width'],
            ['caption-background-mode', 'block', 'caption-style-bg-mode'],
            ['caption-background-color', '#334455', 'caption-style-bg-color'],
            ['caption-background-opacity', '0.7', 'caption-style-bg-opacity'],
            ['caption-background-padding', '12', 'caption-style-bg-padding'],
            ['caption-background-radius', '30', 'caption-style-bg-radius']
        ]) {
            const entry = field(sections, name);
            assert.ok(entry, name);
            assert.equal((await entry.write(snapshots[0], value)).ok, true);
            assert.equal(writes.at(-1).kind, kind);
            assert.deepEqual(writes.at(-1).targets, multi
                ? [{ kind: 'caption', id: 'one' }, { kind: 'caption', id: 'two' }] : undefined);
        }
        assert.equal(field(sections, 'caption-size').inputKind, 'slider-number');
        assert.equal(field(sections, 'caption-background-mode').inputKind, 'caption-mode');
        assert.equal(field(sections, 'caption-background-radius').sliderMax, 30);
    }
});

test('単体と複数選択で短い欄ラベルと明示した単位を使う', () => {
    const snapshots = [caption('one', {
        effectiveTextStyle: { stroke: { widthPx: 6, color: '#000000' } }
    }), caption('two', {
        effectiveTextStyle: { stroke: { widthPx: 6, color: '#000000' } }
    })];
    for (const sections of [
        captionSections(snapshots[0], async () => ({ ok: true })),
        multiCaptionSections(snapshots, async () => ({ ok: true }), {})
    ]) {
        assert.deepEqual(cards(sections).map(card => card.fields.map(entry => entry.label)), [
            ['色', '大きさ', '太さ', '行間', '字間'], ['色', '太さ'],
            ['表示', '形', '色', '不透明度', '余白', '角丸'],
            ['種類', '効果の色', '強さ'], ['位置']
        ]);
        for (const [name, unit] of [
            ['caption-size', 'px'], ['caption-stroke-width', 'px'],
            ['caption-background-opacity', '%'], ['caption-background-radius', 'px'],
            ['caption-style-effect-strength', 'px']
        ]) assert.equal(field(sections, name)?.unit, unit);
    }
    assert.match(source, /角丸を最大にすると文字に沿った丸い座布団（カプセル）になる/u);
    assert.match(source, /valueGroup\.append\(number, unit, defaultNote\)/u);
    assert.match(source, /\.akari-caption-slider-value\s*\{[^}]*display: inline-flex;[^}]*white-space: nowrap;/u);
});

test('スライダー数値欄は符号付き小数五文字と上下ボタンを収める幅を持つ', () => {
    const rule = source.match(/\.akari-inspector-widget \.akari-caption-slider-number input\[type="number"\] \{([^}]+)\}/u)?.[1];
    assert.ok(rule);
    const width = Number(rule.match(/width:\s*(\d+)px/u)?.[1]);
    assert.ok(width >= 72, `number input width: ${width}px`);
    assert.match(rule, new RegExp(`flex:\\s*0 0 ${width}px`, 'u'));
    assert.match(source, /\.akari-caption-slider-number\s*\{[^}]*flex-wrap: wrap;/u);
    for (const value of ['2.20', '-0.10', '3.00', '160', '100']) {
        assert.ok(value.length <= 5);
    }
});

test('座布団の敷く操作と効果は書ける項目だけを更新する', async () => {
    const writes = [];
    const sections = captionSections(caption('one'), async request => { writes.push(request); return { ok: true }; });
    const toggle = field(sections, 'caption-style-bg-enabled');
    await toggle.write(caption('one'), 'true');
    await toggle.write(caption('one'), 'false');
    assert.deepEqual(writes.map(write => write.value), [CAPTION_BACKGROUND_ON_OPACITY, 0]);
    assert.ok(writes.every(write => write.kind === 'caption-style-bg-opacity'));
    assert.deepEqual(captionEffectWrites('none', '#FFFFFF'), [
        { kind: 'caption-style-stroke-color', value: '#000000' },
        { kind: 'caption-style-stroke-width', value: 1.5 }
    ]);
    assert.deepEqual(captionEffectWrites('outline', '#FFFFFF'), [
        { kind: 'caption-style-stroke-color', value: '#000000' },
        { kind: 'caption-style-stroke-width', value: CAPTION_OUTLINE_WIDTH_PX }
    ]);
    assert.equal(captionEffectFromWidth(1.5), 'none');
    assert.equal(captionEffectFromWidth(6), 'outline');
    assert.equal(captionEffectWrites('outline', '#fff')[0].value, '#000000');
    const outlined = captionSections(caption('outlined', {
        effectiveTextStyle: { stroke: { widthPx: 6, color: '#000000' } }
    }), async () => ({ ok: true }));
    assert.deepEqual(cards(outlined)[3].fields.map(item => item.name),
        ['caption-style-effect', 'caption-style-effect-color', 'caption-style-effect-strength']);
    writes.length = 0;
    await field(sections, 'caption-style-effect').write(caption('one'), 'outline');
    assert.deepEqual(writes.map(write => write.kind), ['caption-style-effect']);
    writes.length = 0;
    await field(sections, 'caption-style-effect').write(caption('one'), 'none');
    assert.deepEqual(writes.map(write => write.value), [captionEffectPatch('none', '#FFFFFF')]);
    const multiWrites = [];
    const multi = multiCaptionSections([caption('one'), caption('two')],
        async request => { multiWrites.push(request); return { ok: true }; }, {});
    await field(multi, 'caption-style-bg-enabled').write(caption('one'), 'true');
    await field(multi, 'caption-style-effect').write(caption('one'), 'outline');
    assert.ok(multiWrites.every(write => write.targets?.length === 2));
    assert.match(source, /\['per-line', '行ごと'\], \['block', 'まとめて'\]/u);
});

test('効果五種は保存値から判定し一操作で排他的な項目を書く', async () => {
    const expected = {
        none: { shadow: null, glow: null, stroke: { color: '#000000', widthPx: 1.5 } },
        shadow: { shadow: { color: '#000000', opacity: 0.75, distancePx: 8.5,
            angleDeg: 45, blurPx: 2 }, glow: null, stroke: { color: '#000000', widthPx: 1.5 } },
        raised: { shadow: { color: '#000000', opacity: 0.6, distancePx: 4,
            angleDeg: 90, blurPx: 14 }, glow: null, stroke: { color: '#000000', widthPx: 1.5 } },
        neon: { shadow: null, glow: { color: '#39D5FF', density: 60, spread: 12 },
            stroke: { color: '#000000', widthPx: 1.5 } },
        outline: { shadow: null, glow: null, stroke: { color: '#000000', widthPx: 6 } }
    };
    for (const [effect, patch] of Object.entries(expected)) {
        assert.deepEqual(captionEffectPatch(effect, '#FFFFFF'), patch);
        const writes = [];
        const sections = captionSections(caption('one'), async request => {
            writes.push(request); return { ok: true };
        });
        await field(sections, 'caption-style-effect').write(caption('one'), effect);
        assert.deepEqual(writes, [{ kind: 'caption-style-effect', id: 'one', value: patch }]);
    }
    assert.equal(captionEffectFromStyle({ glow: { color: '#FFFFFF' },
        shadow: { color: '#000000' } }), 'neon');
    assert.equal(captionEffectFromStyle({ shadow: { color: '#000000', blurPx: 14, distancePx: 4 } }), 'raised');
    assert.equal(captionEffectFromStyle({ shadow: { color: '#000000', blurPx: 2, distancePx: 8.5 } }), 'shadow');
    assert.equal(captionEffectFromStyle({ stroke: { widthPx: 6 } }), 'outline');
    assert.equal(captionEffectFromStyle({}), 'none');
    assert.equal(captionEffectFromStyle({ shadow: { color: '#000000', opacity: 0 },
        glow: { color: '#000000', density: 0 } }), 'none');
    assert.deepEqual(captionPresetAwareStylePatch({ shadow: null, glow: null }, 'neon'), {
        shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 }
    });
    assert.deepEqual(captionPresetAwareStylePatch({ shadow: null, glow: null }, undefined),
        { shadow: null, glow: null });
});

test('影とネオンの色と強さは現在の効果オブジェクトを更新する', () => {
    const shadow = captionEffectPatch('shadow', '#FFFFFF');
    assert.deepEqual(captionEffectColorPatch(shadow, '#ABCDEF'),
        { shadow: { ...shadow.shadow, color: '#ABCDEF' } });
    assert.deepEqual(captionEffectStrengthPatch(shadow, 2),
        { shadow: { ...shadow.shadow, distancePx: 17, blurPx: 4 } });
    const neon = captionEffectPatch('neon', '#FFFFFF');
    assert.deepEqual(captionEffectColorPatch(neon, '#ABCDEF'),
        { glow: { ...neon.glow, color: '#ABCDEF' } });
    assert.deepEqual(captionEffectStrengthPatch(neon, 2),
        { glow: { ...neon.glow, spread: 24 } });
});

test('効果の微調整欄は単体と複数選択で一つのパッチ要求を送る', async () => {
    const style = { shadow: { color: '#000000', opacity: 0.75,
        distancePx: 8.5, blurPx: 2, angleDeg: 45 } };
    const snapshots = [caption('one', { effectiveTextStyle: style }),
        caption('two', { effectiveTextStyle: style })];
    for (const multi of [false, true]) {
        const writes = [];
        const sections = multi
            ? multiCaptionSections(snapshots, async request => { writes.push(request); return { ok: true }; }, {})
            : captionSections(snapshots[0], async request => { writes.push(request); return { ok: true }; });
        await field(sections, 'caption-style-effect-color').write(snapshots[0], '#ABCDEF');
        await field(sections, 'caption-style-effect-strength').write(snapshots[0], '2');
        assert.deepEqual(writes.map(write => write.value), [
            { shadow: { ...style.shadow, color: '#ABCDEF' } },
            { shadow: { ...style.shadow, distancePx: 17, blurPx: 4 } }
        ]);
        assert.ok(writes.every(write => write.kind === 'caption-style-effect'));
        assert.ok(writes.every(write => multi ? write.targets?.length === 2 : write.targets === undefined));
    }
});

test('revealField は既知の欄を選び、未知または不正な引数はスタイル先頭に戻す', () => {
    for (const value of ['caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color']) {
        assert.equal(resolveCaptionRevealField({ field: value }), value);
    }
    for (const value of [undefined, {}, { field: 'unknown' }, { field: 12 }]) {
        assert.equal(resolveCaptionRevealField(value), 'caption-style');
    }
    assert.match(contribution, /registerCommand\(REVEAL_AKARI_INSPECTOR_FIELD/u);
    assert.match(contribution, /widget\?\.revealCaptionField\(argument\)/u);
    assert.match(source, /data-inspector-field/u);
});

test('companion が参照する既存欄名と reveal 専用属性を分離する', () => {
    const sections = captionSections(caption('one'), async () => ({ ok: true }));
    const referenced = [...companionFocus.matchAll(/focus\('text','style','(caption-[^']+)'\)/gu)]
        .map(match => match[1]);
    assert.deepEqual(referenced, ['caption-size', 'caption-color', 'caption-zone']);
    for (const name of referenced) assert.ok(field(sections, name), name);
    assert.deepEqual(cards(sections).flatMap(section => section.fields)
        .filter(entry => entry.revealName).map(entry => [entry.name, entry.revealName]), [
        ['caption-color', 'caption-style-color'],
        ['caption-stroke-color', 'caption-style-stroke-color'],
        ['caption-background-color', 'caption-style-bg-color']
    ]);
    assert.equal(field(sections, 'caption-style-effect-color')?.revealName, undefined);
    assert.match(source, /if \(field\.revealName\) row\.setAttribute\('data-inspector-field', field\.revealName\)/u);
    assert.match(source, /section\.id === 'style'\) container\.setAttribute\('data-inspector-field', 'caption-style'\)/u);
});

test('style 親指定の solo は欄を含む一枚のカードだけを残す', () => {
    const sections = captionSections(caption('one'), async () => ({ ok: true }));
    for (const [name, expectedId] of [
        ['caption-zone', 'style:position'],
        ['caption-color', 'style'],
        ['caption-stroke-width', 'style:stroke']
    ]) {
        const filtered = filterInspectorSoloSections('caption', sections, {
            kind: 'caption', tabId: 'text', sectionId: 'style', fieldName: name
        });
        assert.deepEqual(filtered.map(section => section.id), [expectedId]);
        assert.deepEqual(filtered[0].fields.map(entry => entry.name), [name]);
    }
    assert.match(source, /id === requestedSectionId \|\| id\.startsWith\(`\$\{requestedSectionId\}:`\)/u);
});
