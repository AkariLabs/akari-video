// 右レールの見た目と配線（task 2026-09-22-right-rail-regroup）: 5 パネルのアイコンが試作の線画
// （ハサミ / 紙 / 吹き出し / つまみ / レベルのバー）になっていること、レールのホバーは Theia の遅延
// ツールチップを止めて名前（label）だけを出すこと、ハンドラーとドラッグの配線、押す / ドラッグの判別。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const icons = require('../lib/browser/right-rail-icons.js');
const style = require('../lib/browser/right-rail-style.js');
const gesture = require('../lib/browser/right-rail-drag-gesture.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

const WIDGETS = {
    cuts: '../../akari-transcript/src/browser/daihon/akari-cuts-widget.ts',
    daihon: '../../akari-transcript/src/browser/daihon/akari-daihon-widget.ts',
    review: '../../akari-annotations/src/browser/akari-review-panel-widget.ts',
    inspector: '../../akari-annotations/src/browser/akari-inspector-widget.ts',
    audioMeter: '../../akari-preview/src/browser/akari-audio-meter-widget.ts'
};

test('the five right-rail widgets use the line-art icon classes (no codicon)', () => {
    for (const [key, path] of Object.entries(WIDGETS)) {
        const lines = read(path).split('\n').filter(line => line.includes('this.title.iconClass'));
        assert.equal(lines.length, 1, path);
        assert.equal(lines[0].trim(), `this.title.iconClass = '${icons.RIGHT_RAIL_ICON_CLASS[key]}';`, path);
    }
});

test('icon shapes are the prototype strokes: scissors / paper / speech bubble / sliders / level bars', () => {
    const P = icons.RIGHT_RAIL_ICON_PATHS;
    // ハサミ = 2 つの輪 + 交差する 2 本の刃。
    assert.equal((P.cuts.match(/<circle/g) ?? []).length, 2);
    assert.match(P.cuts, /M8 8\.5L19 18M8 15\.5L19 6/);
    // 紙 = 角を折った紙 + 行。
    assert.match(P.daihon, /M7 3h7l4 4v14H7z/);
    // 吹き出し = 尾のついた枠。
    assert.equal(P.review, '<path d="M5 5h14v10H10l-5 4z"/>');
    // つまみ = 3 本の横線 + 3 つのつまみ。
    assert.equal((P.inspector.match(/<circle/g) ?? []).length, 3);
    // レベルのバー = 高さの違う 4 本の縦棒。
    assert.equal(P.audioMeter, '<path d="M6 20V10M10 20V4M14 20v-7M18 20V8"/>');
    const css = icons.rightRailIconCss();
    for (const key of Object.keys(icons.RIGHT_RAIL_ICON_CLASS)) {
        const cls = icons.RIGHT_RAIL_ICON_CLASS[key].split(' ')[1];
        const match = css.match(new RegExp(`\\.${cls} \\{ mask-image: url\\("data:image/svg\\+xml;base64,([^"]+)"\\)`));
        assert.ok(match, cls);
        const svg = Buffer.from(match[1], 'base64').toString('utf8');
        assert.ok(svg.includes(P[key]), `${cls} carries its path`);
        assert.match(svg, /fill="none" stroke="#fff" stroke-width="1\.75"/, 'line art, not a glyph');
    }
    // 絵文字・記号文字は使わない。
    assert.doesNotMatch(css, /[\u{1F300}-\u{1FAFF}☀-➿]/u);
});

test('rail hover: Theia delayed tooltip is suppressed and the instant tooltip shows the label only', () => {
    const handler = read('../src/browser/akari-right-panel-handler.ts');
    assert.match(handler, /renderer\.handleMouseEnterEvent = \(\) => undefined;/);
    const tooltip = read('../src/browser/right-rail-tooltip.ts');
    assert.match(tooltip, /this\.show\(tab, title\.label\)/);
    assert.doesNotMatch(tooltip, /title\.caption/);
    assert.doesNotMatch(tooltip, /setTimeout/, 'no delay');
});

test('the right side panel handler and the drop zones are wired in the frontend module', () => {
    const module = read('../src/browser/akari-shell-strip-frontend-module.ts');
    assert.match(module, /rebind\(SidePanelHandler\)\.to\(AkariRightPanelHandler\);/);
    assert.match(module, /bind\(FrontendApplicationContribution\)\.toService\(AkariRightRailDnd\);/);
    const app = read('../src/browser/akari-frontend-application.ts');
    assert.equal((app.match(/this\.resetRightRail\(\);/g) ?? []).length, 3, 'timeout / false / throw all reset the rail');
    const dnd = read('../src/browser/akari-right-rail-dnd.ts');
    for (const label of ['メインへ置く', '下へ置く（タイムラインの隣）', '右の上の段に分ける', '右の下の段に分ける', '線の上へ', '線の下へ']) {
        assert.ok(dnd.includes(`'${label}'`), label);
    }
    assert.ok(style.RIGHT_RAIL_CSS.includes('--akari-rail-middle'), 'separator is placed at the measured middle');
    assert.match(style.RIGHT_RAIL_CLOSE_ICON_SVG, /M6 6l12 12M18 6L6 18/);
});

class FakeNode extends EventTarget {}
const pointer = (type, x, y, button = 0) => Object.assign(new Event(type), { clientX: x, clientY: y, button });

test('trackDragGesture: small movement is a click (at the press point), a larger one starts a drag once', () => {
    globalThis.window = new EventTarget();
    try {
        const node = new FakeNode();
        const calls = [];
        gesture.trackDragGesture(node, {
            onClick: (x, y) => calls.push(['click', x, y]),
            onStart: (x, y, px, py) => calls.push(['start', x, y, px, py])
        });
        node.dispatchEvent(pointer('pointerdown', 10, 10));
        window.dispatchEvent(pointer('pointermove', 12, 13));
        window.dispatchEvent(pointer('pointerup', 12, 13));
        node.dispatchEvent(pointer('pointerdown', 20, 20));
        window.dispatchEvent(pointer('pointermove', 20, 26));
        window.dispatchEvent(pointer('pointermove', 20, 40));
        window.dispatchEvent(pointer('pointerup', 20, 40));
        node.dispatchEvent(pointer('pointerdown', 5, 5, 2));
        window.dispatchEvent(pointer('pointerup', 5, 5, 2));
        assert.deepEqual(calls, [['click', 10, 10], ['start', 20, 26, 20, 20]]);
    } finally {
        delete globalThis.window;
    }
});
