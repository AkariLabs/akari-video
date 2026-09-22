import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PARTNER_TERMINAL_CSS as css } from '../lib/browser/partner-terminal-style.js';

const rules = css.match(/[^{}]+\{[^{}]*\}/g);
const iconRules = agent => rules.filter(rule =>
    rule.split('{')[0].includes(`.akari-partner-${agent}-cli-icon`)
).map(rule => rule.trim()).join('\n');

test('Claude は選択・ホバー時のタブ色に依存しないブランドオレンジ', () => {
    assert.match(iconRules('claude'), /background-color: #D97757 !important;/);
});

test('Codex / Copilot はボタン・タブの選択色ではなくテーマの文字色を共有する', () => {
    for (const agent of ['codex', 'copilot']) {
        assert.match(iconRules(agent), /background-color: var\(--theia-editor-foreground, currentColor\) !important;/);
    }
});

test('Antigravity は提供された公式多色 SVG を background-image で描く', () => {
    const rule = rules.find(rule => rule.trimStart().startsWith('.akari-partner-antigravity-cli-icon {'));
    assert.match(rule, /background-image: url\("data:image\/svg\+xml;base64,/);
    assert.match(rule, /\n    mask-image: none;/);
    assert.match(rule, /-webkit-mask-image: none;/);
    assert.match(iconRules('antigravity'), /background-color: transparent !important;/);
    const encoded = rule.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)[1];
    const svg = Buffer.from(encoded, 'base64');
    assert.equal(createHash('sha256').update(svg).digest('hex'), '8522070f8ab5fd893c052c1f642eb6eb9397ef9fffe857e4931a5cf376064ebf');
    const text = svg.toString('utf8');
    assert.doesNotMatch(text, /<script\b|\son\w+\s*=|\b(?:xlink:)?href\s*=/i);
    const references = [...text.matchAll(/url\(([^)]+)\)/g)].map(match => match[1]);
    assert.ok(references.length > 0);
    for (const reference of references) {
        assert.match(reference, /^#[\w-]+$/);
        assert.ok(text.includes(`id="${reference.slice(1)}"`));
    }
    for (const color of ['#3186FF', '#FC413D', '#00B95C', '#FBBC04']) {
        assert.ok(text.includes(color));
    }
});

test('Antigravity のサイドタブは background shorthand に画像を消されず、中央に標準サイズで描く', () => {
    const sideRule = rules.find(rule => rule.includes('.lm-TabBar.theia-app-sides .lm-TabBar-tabIcon.akari-partner-antigravity-cli-icon {'));
    const baseRule = rules.find(rule => rule.trimStart().startsWith('.akari-partner-antigravity-cli-icon {'));
    assert.ok(sideRule);
    const image = baseRule.match(/background-image: (url\("[^"]+"\));/)[1];
    assert.ok(sideRule.includes(`background-image: ${image} !important;`));
    assert.match(sideRule, /background-size: var\(--theia-private-sidebar-icon-size\) !important;/);
    assert.match(sideRule, /background-position: 50% 50% !important;/);
    assert.match(sideRule, /background-repeat: no-repeat !important;/);
    assert.match(baseRule, /background-size: contain;/);
    assert.match(baseRule, /background-position: 50% 50%;/);
    assert.match(baseRule, /background-repeat: no-repeat;/);
});

// 2026-09-22 の編集前に評価した出力 CSS。共通ルールも含め文字列を固定する。
// 現行ソースから期待値を再生成しないこと。
test('Grok / Cursor / OpenCode / Command Code の出力 CSS は BEFORE と同一', () => {
    const before = JSON.parse(readFileSync(new URL('./fixtures/partner-icons-before.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(before), ['grok', 'cursor', 'opencode', 'commandcode']);
    for (const [agent, expected] of Object.entries(before)) {
        assert.equal(iconRules(agent), expected, agent);
    }
});

test('3 つの表示面が共通の iconClass 対応表を参照する', () => {
    const read = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');
    const widget = read('akari-partner-widget.tsx');
    assert.match(widget, /className=\{PARTNER_CLI_ICON_CLASSES\[entry.agent\]\}/);
    assert.match(widget, /iconClass: PARTNER_CLI_ICON_CLASSES\[entry.agent\]/);
    assert.match(read('akari-partner-catalog-widget.tsx'), /className=\{PARTNER_CLI_ICON_CLASSES\[group.agent\]\}/);
});
