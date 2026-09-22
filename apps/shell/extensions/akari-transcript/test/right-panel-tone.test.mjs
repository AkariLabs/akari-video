import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cuts = readFileSync(new URL('../src/browser/daihon/akari-cuts-widget.ts', import.meta.url), 'utf8');
const daihon = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const style = daihon.match(/const STYLE = `([\s\S]*?)`;/)[1];
const rule = selector => {
    const start = style.indexOf(`${selector} {`);
    assert.notEqual(start, -1, selector);
    return style.slice(start, style.indexOf('}', start));
};
const tokens = readFileSync(new URL('../../akari-theme/src/browser/akari-theme-tokens.ts', import.meta.url), 'utf8');
const palettes = Object.fromEntries(['DARK', 'LIGHT'].map(theme => {
    const block = tokens.match(new RegExp(`export const ${theme}[^=]*= \\{([\\s\\S]*?)\\};`))[1];
    return [theme, Object.fromEntries([...block.matchAll(/(\w+): '#([\da-f]{6})'/g)]
        .map(match => [match[1], match[2]]))];
}));
const rgb = hex => hex.replace('#', '').match(/\w\w/g).map(value => parseInt(value, 16) / 255);
const mix = (foreground, background, ratio) => foreground.map((value, i) => value * ratio + background[i] * (1 - ratio));
const luminance = rgb => {
    const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
};
const contrast = (foreground, background) => {
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter + .05) / (darker + .05);
};
const declaration = (css, property) => css.match(new RegExp(`(?:^|[;{])\\s*${property}:([^;]+);`))?.[1].trim();

test('カットと台本の面・文字・枠は共通テーマの色を使う', () => {
    for (const source of [cuts, daihon]) assert.doesNotMatch(source, /#20242b|#1b1f26/i);
    assert.match(cuts, /background: 'var\(--theia-editor-background\)'/);
    assert.match(cuts, /color: 'var\(--akari-ink, var\(--theia-foreground\)\)'/);
    assert.match(cuts, /background: 'var\(--akari-card\)'/);
    assert.match(cuts, /'var\(--akari-accent\)' : 'var\(--akari-line\)'/);
    assert.match(rule('.akari-daihon-widget'), /background:var\(--theia-editor-background\); color:var\(--akari-ink, var\(--theia-foreground\)\)/);
    assert.doesNotMatch(style, /#2a303a|#262c37|#e9ecf2|#171b21|#12151a|#333b48/i);
    assert.match(rule('.akari-daihon-word'), /color:var\(--akari-muted\)/);
    assert.match(rule('.akari-daihon-word.past'), /color:var\(--akari-ink, var\(--theia-foreground\)\)/);
});

test('カットのフッターボタンは生成後にテーマ色で上書きし、順序と disabled を維持する', () => {
    const footer = cuts.slice(cuts.indexOf("this.foot.replaceChildren(transcribeElement('p'"));
    const buttons = [...footer.matchAll(/const (\w+) = transcribeButton\('([^']+)'/g)].map(match => match.slice(1));
    assert.deepEqual(buttons, [['previewButton', 'プレビューで見る'], ['timelineButton', 'タイムラインへ']]);
    assert.equal([...footer.matchAll(/\}, !first\);/g)].length, 2);
    const overrideStart = footer.indexOf('for (const button of [previewButton, timelineButton]) {');
    const append = footer.indexOf('this.foot.append(previewButton, timelineButton);');
    assert.ok(overrideStart > footer.lastIndexOf('}, !first);'), '両ボタンの生成後に上書きする');
    assert.ok(append > overrideStart, '上書きした同じ2ボタンを元の順序で append する');
    const override = footer.slice(overrideStart, append);
    assert.match(override, /Object\.assign\(button\.style, \{/);
    assert.match(override, /background: 'var\(--akari-elevated\)'/);
    assert.match(override, /border: '1px solid var\(--akari-line\)'/);
    assert.match(override, /color: 'var\(--akari-ink, var\(--theia-foreground\)\)'/);
    assert.doesNotMatch(override, /disabled|opacity|cursor|addEventListener|onclick/);
    assert.match(footer, /listenTranscribeRange\(this\.commands, this\.shell, this\.opener/);
    assert.match(footer, /this\.service\.applyCutsToEdit\(request\)/);
});

test('台本の内側見出しだけを隠し、ヘッダーの寸法と他の操作・タブ名を維持する', () => {
    assert.match(rule('.akari-daihon-title'), /visibility:hidden/);
    assert.doesNotMatch(rule('.akari-daihon-head'), /display:none|height:0/);
    assert.match(rule('.akari-daihon-head'), /gap:7px; padding:8px 11px/);
    assert.match(daihon, /header\.append\(title, this\.count, spacer, this\.captionsButton, this\.placeTextButton, this\.retimeButton, this\.historyButton, this\.displayButton, this\.tplButton, this\.qcButton, this\.silenceButton, this\.cutsButton\)/);
    assert.match(daihon, /this\.title\.label = '台本'/);
});

test('ダーク・ライトの主要テキストは共通パレットの各面で WCAG AA を満たす', t => {
    for (const [theme, palette] of Object.entries(palettes)) {
        for (const foreground of ['ink', 'muted']) {
            for (const background of ['bg', 'card', 'elevated', 'accentTint']) {
                const ratio = contrast(rgb(palette[foreground]), rgb(palette[background]));
                t.diagnostic(`${theme} ${foreground}/${background}: ${ratio.toFixed(2)}:1`);
                assert.ok(ratio >= 4.5, `${theme} ${foreground}/${background}: ${ratio}`);
            }
        }
    }
});

// Action labels and body text require 4.5; small status badges and symbols require 3.
const stateTextRules = [
    ['.akari-daihon-qc.ok', '#6fdc9f', 3],
    ['.akari-daihon-qc.warn', '#f0b45a', 3],
    ['.akari-daihon-badge-edited', '#7fe7d3', 3],
    ['.akari-daihon-badge-breaklock', '#7fe7d3', 3],
    ['.akari-daihon-historyrow button.akari-daihon-historyrestore', '#7fe7d3', 4.5],
    ['.akari-daihon-segments button.selected', '#7fe7d3', 4.5],
    ['.akari-daihon-pop button.primary', '#7fe7d3', 4.5],
    ['.akari-daihon-cutrange .band.tgt', '#7fe7d3', 3],
    ['.akari-daihon-badge-tpl', '#c9b8ff', 3],
    ['.akari-daihon-badge-qc', '#f0b45a', 3],
    ['.akari-daihon-word-filler', '#d9927f', 4.5],
    ['.akari-daihon-cutcell .akari-daihon-rbtn', '#d9927f', 4.5],
    ['.akari-daihon-cutcell', '#a05f4f', 4.5],
    ['.akari-daihon-cutcell .akari-daihon-rbtn:hover:not(:disabled)', '#ffb39e', 4.5],
    ['.akari-daihon-cutrange button.primary', '#ffb39e', 4.5],
    ['.akari-daihon-cut:hover', '#ff8f73', 4.5],
    ['.akari-daihon-pop button.danger', '#ff9d84', 4.5],
    ['.akari-daihon-word-unk', '#b08a5a', 4.5],
    ['.akari-daihon-tc:hover', '#53d1bc', 4.5],
    ['.akari-daihon-slash', '#53d1bc', 3],
    ['.akari-daihon-slash.manual', '#53d1bc', 3]
];

for (const [selector, original, threshold] of stateTextRules) {
    test(`${selector}: 状態色をテーマ文字色と混ぜ、両テーマの各面でコントラストを維持する`, t => {
        const css = rule(selector);
        const color = declaration(css, 'color');
        // Read the actual CSS weight, so a change to the production ratio is checked numerically.
        const parsed = color?.match(/^color-mix\(in srgb, (#[\da-f]{6}) ([\d.]+)%, var\(--akari-ink, var\(--theia-foreground\)\)\)$/);
        assert.ok(parsed, `${selector}: ${color}`);
        assert.equal(parsed[1], original, '元の状態色の色相を保持する');
        const weight = Number(parsed[2]) / 100;
        assert.ok(weight > 0 && weight < 1, '状態色とテーマ文字色の両方を含む');
        const opacity = Number(declaration(css, 'opacity') ?? 1);
        const background = declaration(css, 'background');
        const tint = background?.match(/^color-mix\(in srgb, (#[\da-f]{6}) ([\d.]+)%, (transparent|var\(--akari-card\))\)$/);
        const rgba = background?.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
        for (const [theme, palette] of Object.entries(palettes)) {
            const foreground = mix(rgb(original), rgb(palette.ink), weight);
            let minimum = Infinity;
            for (const surface of ['bg', 'card', 'elevated']) {
                const base = rgb(palette[surface]);
                const backgrounds = [base];
                // Also cover the existing green fills and the slash's 0.8 opacity.
                if (tint) backgrounds.push(mix(rgb(tint[1]), tint[3] === 'transparent' ? base : rgb(palette.card), Number(tint[2]) / 100));
                if (rgba) backgrounds.push(mix(rgba.slice(1, 4).map(Number).map(value => value / 255), base, Number(rgba[4])));
                for (const bg of backgrounds) {
                    const ratio = contrast(mix(foreground, bg, opacity), bg);
                    const context = `${selector} ${theme}/${surface}: ${ratio.toFixed(2)}:1`;
                    minimum = Math.min(minimum, ratio);
                    assert.ok(ratio >= threshold, context);
                    if (theme === 'DARK') {
                        assert.ok(ratio >= contrast(mix(rgb(original), bg, opacity), bg), `${context}: ダークのコントラストを下げない`);
                    }
                }
            }
            t.diagnostic(`${theme} ${parsed[2]}%: minimum ${minimum.toFixed(2)}:1`);
        }
    });
}

test('台本 STYLE とカットに生の hex 文字色を残さない', () => {
    assert.doesNotMatch(style, /[;{]\s*color:\s*#[\da-f]+\s*;/i);
    assert.doesNotMatch(cuts, /(?:\bcolor:\s*|\.style\.color\s*=\s*)['"]#[\da-f]+['"]/i);
});
