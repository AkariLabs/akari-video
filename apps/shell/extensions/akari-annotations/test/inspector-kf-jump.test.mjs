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

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.disabled = false;
    }

    setAttribute(name, value) {
        this.attributes.set(name, value);
    }

    addEventListener(type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    append(...children) {
        this.children.push(...children);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    emit(type) {
        for (const listener of this.listeners.get(type) ?? []) listener({});
    }
}

function withFakeDocument(callback) {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { createElement: tagName => new FakeElement(tagName) }
    });
    try {
        return callback();
    } finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
    }
}

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

test('KF がある有効行の席には活性な ⤢ が末尾にあり、reveal を発火する', () => withFakeDocument(() => {
    let reveals = 0;
    const seat = createKeyframeSeat('transform-x', keyframeOptions(true, () => reveals++));
    assert.deepEqual(seat.children.map(child => child.textContent), ['‹', '◇', '›', '⤢']);
    const jump = seat.children.at(-1);
    assert.equal(jump.disabled, false);
    assert.equal(jump.title, 'タイムラインのキーフレーム行を開く');
    assert.equal(jump.attributes.get('data-akari-ui'), 'inspector-kf-jump:transform-x');
    jump.emit('click');
    assert.equal(reveals, 1);
}));

test('KF が無い有効行の ⤢ は disabled、無効行には ⤢ を描かない', () => withFakeDocument(() => {
    const empty = createKeyframeSeat('opacity', keyframeOptions(false));
    const jump = empty.children.at(-1);
    assert.equal(jump.textContent, '⤢');
    assert.equal(jump.disabled, true);
    assert.equal(jump.title, 'キーフレームがありません');

    const unsupported = createKeyframeSeat('crop-x');
    assert.deepEqual(unsupported.children.map(child => child.textContent), ['‹', '◇', '›']);
}));

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
