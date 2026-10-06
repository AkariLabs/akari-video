import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';

const daihon = readAllSourceText();
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

test('台本の面・文字・枠は共通テーマの色を使う', () => {
    assert.doesNotMatch(daihon, /#20242b|#1b1f26/i);
    assert.match(rule('.akari-daihon-widget'), /background:var\(--theia-editor-background\); color:var\(--akari-ink, var\(--theia-foreground\)\)/);
    assert.doesNotMatch(style, /#2a303a|#262c37|#e9ecf2|#171b21|#12151a|#333b48/i);
    assert.match(rule('.akari-daihon-word'), /color:var\(--akari-muted\)/);
    assert.match(rule('.akari-daihon-word.past'), /color:var\(--akari-ink, var\(--theia-foreground\)\)/);
});

test('台本のヘッダーは折り返さない', () => {
    assert.doesNotMatch(rule('.akari-daihon-head'), /display:none|height:0/);
    assert.match(rule('.akari-daihon-head'), /flex-wrap:nowrap/);
});

test('400px の選択バーは横スクロールを使わず折り返せる', () => {
    const actionBar = rule('.akari-daihon-actionbar');
    assert.match(actionBar, /flex-wrap:wrap/);
    assert.match(actionBar, /min-width:0/);
    assert.match(actionBar, /box-sizing:border-box/);
    assert.doesNotMatch(actionBar, /overflow-x/);
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
    ['.akari-daihon-cut:hover:not(:disabled)', '#ff8f73', 4.5],
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

test('台本 STYLE に生の hex 文字色を残さない', () => {
    assert.doesNotMatch(style, /[;{]\s*color:\s*#[\da-f]+\s*;/i);
});
