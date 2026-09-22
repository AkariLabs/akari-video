import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { createNumberField, createKeyframeSeat } from '../lib/browser/inspector/number-field.js';
import { createSelectionHeader } from '../lib/browser/inspector/selection-header.js';
import { withInspectorDom } from './helpers/inspector-dom.mjs';

const widget = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const sourceDir = new URL('../src/browser/inspector/', import.meta.url);
const keyframe = { active: true, hasKeyframes: true, onToggle() {}, onPrevious() {}, onNext() {}, onReveal() {} };

function columns(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rules = [...widget.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
    const declaration = rules.map(match => match[1].match(/grid-template-columns:\s*([^;]+);/u)?.[1]).filter(Boolean).at(-1);
    assert.ok(declaration, selector);
    return declaration.match(/minmax\([^)]*\)|[^\s]+/g);
}

test('(c) 数値欄は実際の子と同数のグリッド列を持ち、入力はゼロまで縮む', () => withInspectorDom(() => {
    for (const seat of [undefined, keyframe]) {
        const field = createNumberField({ name: 'x', label: 'X', value: 0, step: 1, keyframe: seat, onCommit: async () => true });
        const tracks = columns(seat ? '.akari-inspector-number-field' : '.akari-inspector-number-field-seatless');
        assert.equal(tracks.length, field.children.length);
        assert.equal(tracks[1], 'minmax(0, 1fr)');
        if (seat) assert.equal(tracks.at(-1), '80px', 'four 20px controls have an 80px track');
    }
    assert.equal(columns('.akari-adjust-editor-luminance .akari-inspector-number-field').length, 4);
    const adjust = readFileSync(new URL('../src/browser/inspector/adjust-editors.ts', import.meta.url), 'utf8');
    assert.match(adjust, /field\.querySelector\('\.akari-inspector-kf-controls'\)\?\.remove\(\)/u);
}));

test('(d) インスペクターの本体と全モジュールに旧 KF グリフを残さない', () => {
    assert.doesNotMatch(widget, /[‹◆◇›⤢]/u);
    for (const file of readdirSync(sourceDir).filter(name => name.endsWith('.ts'))) {
        assert.doesNotMatch(readFileSync(new URL(file, sourceDir), 'utf8'), /[‹◆◇›⤢]/u, file);
    }
});

test('KF ナビと打点の操作は既存コールバックを一度だけ呼ぶ', () => withInspectorDom(() => {
    const calls = [];
    const seat = createKeyframeSeat('x', { ...keyframe,
        onPrevious: () => calls.push('previous'), onToggle: () => calls.push('toggle'), onNext: () => calls.push('next') });
    seat.children.slice(0, 3).forEach(button => button.emit('click'));
    assert.deepEqual(calls, ['previous', 'toggle', 'next']);
    assert.equal(seat.children[1].attributes.get('aria-pressed'), 'true');
    assert.match(widget, /kf-seat\[aria-pressed="true"\] svg\s*\{\s*fill: currentColor/u);
}));

test('横幅ガード・カード・トークンを固定し、狭幅は縦に並べる', () => {
    assert.match(widget, /overflowX: 'hidden'/u);
    assert.match(widget, /overflowY: 'auto'/u);
    assert.match(widget, /containerType: 'inline-size'/u);
    assert.match(widget, /@container \(max-width: 300px\)/u);
    assert.match(widget, /grid-template-columns: 64px minmax\(0, 1fr\)/u);
    assert.match(widget, /\.akari-inspector-section\s*\{[^}]*border: 1px solid var\(--akari-line\);[^}]*border-radius: 8px;[^}]*background: var\(--akari-card\)/u);
    assert.doesNotMatch(widget, /#(?:634398|b89aff|a78bfa)|--theia-(?:input|button|panel|foreground|focusBorder|editor-background)/iu);
});

test('選択帯は既存スナップショットから名前・範囲・種別とサムネを表示する', () => withInspectorDom(async () => {
    const paths = [];
    const header = createSelectionHeader({ kind: 'cut', clipName: 'タイトル.mp4', sourcePath: 'assets/title.mp4',
        outputStart: 3.2, outputEnd: 8 }, async path => { paths.push(path); return 'data:image/png;base64,AA'; });
    assert.equal(header.children[1].children[0].textContent, 'タイトル.mp4');
    assert.equal(header.children[1].children[1].textContent, '00:03.2 – 00:08.0 · カット');
    await Promise.resolve();
    assert.deepEqual(paths, ['assets/title.mp4']);
    assert.equal(header.children[0].children[0].src, 'data:image/png;base64,AA');
    assert.ok(widget.indexOf('this.body.appendChild(createSelectionHeader(snapshot') < widget.indexOf('this.renderGapSelection(snapshot)', widget.indexOf('protected render():')));
}));

test('字幕・音声・複数選択とサムネなしにも選択帯を描画し、外れた帯には非同期結果を入れない', () => withInspectorDom(async () => {
    for (const [snapshot, label, meta] of [
        [{ kind: 'caption', text: '字幕', outputStart: undefined, outputEnd: undefined }, '字幕', '字幕'],
        [{ kind: 'audio', clipName: 'BGM', outputStart: 1, duration: 2 }, 'BGM', '00:01.0 – 00:03.0 · 音声'],
        [{ kind: 'multi', count: 2, items: [{ outputStart: 1, outputEnd: 2 }, { outputStart: 4, duration: 2 }] }, '2 個を選択中', '00:01.0 – 00:06.0 · 複数選択']
    ]) {
        const header = createSelectionHeader(snapshot, async () => assert.fail('no source'));
        assert.equal(header.children[1].children[0].textContent, label);
        assert.equal(header.children[1].children[1].textContent, meta);
        assert.equal(header.children[0].children.length, 0);
    }
    const stale = createSelectionHeader({ kind: 'layer', clipName: 'Old', src: 'old.png', outputStart: 0, duration: 1 },
        async () => 'data:image/png;base64,AA');
    stale.isConnected = false;
    await Promise.resolve();
    assert.equal(stale.children[0].children.length, 0);
}));
