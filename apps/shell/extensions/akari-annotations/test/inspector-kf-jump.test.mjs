import { withInspectorDom as withFakeDocument } from './helpers/inspector-dom.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createKeyframeSeat } from '../lib/browser/inspector/number-field.js';

const inspectorSource = readFileSync(
    new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'
);
const timelineSource = readFileSync(
    new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);
const protocolSource = readFileSync(
    new URL('../src/browser/timeline-selection-model.ts', import.meta.url), 'utf8'
);

function between(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} が見つかりません`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `${endNeedle} が見つかりません`);
    return source.slice(start, end);
}

function keyframeOptions(hasKeyframes, onReveal = () => {}) {
    return {
        active: false,
        hasKeyframes,
        onToggle() {},
        onPrevious() {},
        onNext() {},
        onReveal
    };
}

test('KF の4つ目の SVG ボタンから reveal メニューを開いて既存の操作を発火する', () => withFakeDocument(({ document }) => {
    let reveals = 0;
    const seat = createKeyframeSeat('transform-x', keyframeOptions(true, () => reveals++));
    assert.equal(seat.children.length, 4);
    assert.ok(seat.children.every(child => child.tagName === 'BUTTON' && child.children[0].innerHTML.includes('<svg')));
    const more = seat.children[3];
    assert.equal(more.attributes.get('aria-haspopup'), 'menu');
    assert.equal(more.attributes.get('aria-expanded'), 'false');
    assert.equal(document.body.children.length, 0);
    more.emit('click');
    assert.equal(seat.children.length, 4, 'menu must not become a fifth control');
    assert.equal(more.attributes.get('aria-expanded'), 'true');
    const menu = document.body.children[0];
    assert.equal(menu.open, true);
    assert.equal(menu.attributes.get('role'), 'menu');
    assert.equal(menu.children.length, 1, 'only the implemented reveal action belongs in this menu');
    const jump = menu.children[0];
    assert.equal(jump.disabled, false);
    assert.equal(jump.title, 'タイムラインのキーフレーム行を開く');
    assert.equal(jump.attributes.get('data-akari-ui'), 'inspector-kf-jump:transform-x');
    assert.equal(jump.children[1].textContent, jump.title);
    jump.emit('click');
    assert.equal(reveals, 1);
    assert.equal(document.body.children.length, 0);
    assert.equal(more.attributes.get('aria-expanded'), 'false');
}));

test('KF がない行もメニューを開けるが reveal は無効、非対応行の4席は無効', () => withFakeDocument(({ document }) => {
    let reveals = 0;
    const empty = createKeyframeSeat('opacity', keyframeOptions(false, () => reveals++));
    empty.children[3].emit('click');
    const jump = document.body.children[0].children[0];
    assert.equal(jump.attributes.get('data-akari-ui'), 'inspector-kf-jump:opacity');
    assert.equal(jump.disabled, true);
    assert.equal(jump.title, 'キーフレームがありません');
    jump.emit('click');
    assert.equal(reveals, 0);
    empty.children[3].emit('click');
    const unsupported = createKeyframeSeat('crop-x');
    assert.equal(unsupported.children.length, 4);
    assert.ok(unsupported.children.every(child => child.disabled));
    unsupported.children[3].emit('click');
    assert.equal(document.body.children.length, 0);
}));

for (const reason of ['Escape', 'dismiss', 'scroll', 'resize', 'selection']) {
    test(`KF メニューは ${reason} で閉じ、リスナーと監視を解除する`, () => withFakeDocument(({ document, window, observers }) => {
        const seat = createKeyframeSeat('x', keyframeOptions(true));
        const more = seat.children[3];
        more.emit('click');
        const menu = document.body.children[0];
        if (reason === 'Escape') menu.emit('keydown', { key: 'Escape' });
        if (reason === 'dismiss') menu.emit('toggle', { newState: 'closed' });
        if (reason === 'scroll') document.emit('scroll');
        if (reason === 'resize') window.emit('resize');
        if (reason === 'selection') { more.isConnected = false; observers[0].callback(); }
        assert.equal(document.body.children.length, 0);
        assert.equal(more.attributes.get('aria-expanded'), 'false');
        assert.equal(observers[0].observing, false);
        assert.equal(document.listeners.get('scroll').length, 0);
        assert.equal(window.listeners.get('resize').length, 0);
    }));
}

test('有効行のダブルクリックは reveal request へ配線し、入力部品上では抑止する', () => {
    const options = between(inspectorSource, 'protected keyframeSeatOptions(', 'protected appendRow(');
    assert.match(options, /onReveal: \(\) => request\('reveal'\)/u);
    assert.match(options, /snapshot\.keyframes\?\.some\([\s\S]*keyframeValueAt/u);

    const row = between(inspectorSource, "if (field.inputKind === 'scrub-number') {", "if (field.inputKind === 'color') {");
    assert.match(row, /row\.addEventListener\('dblclick'/u);
    assert.match(row, /closest\('input, textarea, select, button, \[contenteditable="true"\]'\)/u);
    assert.match(row, /keyframe\.onReveal\(\)/u);
});

test('reveal は正本プロトコルに属し、最寄り KF 選択・行表示・強調・スクロールを行う', () => {
    assert.match(protocolSource, /action: [^;]*'reveal'/u);
    const reveal = between(
        timelineSource,
        "if (request.action === 'reveal') {",
        "if (request.action === 'previous' || request.action === 'next') {"
    );
    assert.match(reveal, /times\.reduce/u);
    assert.match(reveal, /this\.selectionModel\.keyframeSelection = \{/u);
    assert.match(reveal, /this\.applyFocusScope\(enterFocusScope/u);
    assert.match(reveal, /this\.applyKeyframePropertySelectionClass\(\)/u);
    assert.match(reveal, /this\.scrollTimelineKeyframeRowIntoView/u);
    assert.doesNotMatch(reveal, /requestSeek/u);
});
