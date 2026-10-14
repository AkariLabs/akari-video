import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { selectableCaptionWords } from '../lib/common/daihon-word-units.js';
import { extendWordRange, wordRangeSummary } from '../lib/common/daihon-word-selection.js';
import { isDaihonCompositionStart, isPrintableDaihonKey, selectedDaihonEdit,
    wordSelectionHeading } from '../lib/common/daihon-dock.js';
import { changedWordPresetRowIds } from '../lib/common/daihon-reconcile.js';
import { defaultCutRange } from '../lib/common/daihon-cut-range.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const transcript = readFileSync(join(here, '../src/browser/daihon/akari-daihon-widget.ts'), 'utf8');
const preview = readFileSync(join(here, '../../akari-preview/src/browser/preview-script-bootstrap.ts'), 'utf8');
const previewHost = readFileSync(join(here, '../../akari-preview/src/browser/akari-preview-open-handler.ts'), 'utf8');

test('語が無い行と不一致の行でも本文から時刻付きの選択単位を作り、Shift 範囲を選べる', () => {
    for (const tokens of [null, [{ text: '別文', start: 2, end: 3 }]]) {
        const words = selectableCaptionWords('今日は晴れ', 2, 4, tokens);
        assert.equal(words.map(word => word.text).join(''), '今日は晴れ');
        assert.ok(words.length > 1);
        assert.equal(words[0].start, 2);
        assert.equal(words.at(-1).end, 4);
        const range = extendWordRange([{ row: 'c1', a: 0, b: 0 }],
            { row: 'c1', index: words.length - 1 }, ['c1']);
        assert.deepEqual(range, [{ row: 'c1', a: 0, b: words.length - 1 }]);
        assert.equal(wordRangeSummary([{ id: 'c1', words }], range).text, '今日は晴れ');
    }
    assert.match(transcript, /this\.dockKind === 'row' && this\.dockTab === 'emphasis'\) this\.renderDock\(\)/);
});

test('行選択の印字キーは本文の末尾へ追記し、単語選択ならその範囲だけ置換する', () => {
    assert.equal(isPrintableDaihonKey('a', false, false, false, false), true);
    for (const args of [['a', true, false, false, false], ['a', false, false, true, false],
        ['a', false, false, false, true], ['Enter', false, false, false, false]]) {
        assert.equal(isPrintableDaihonKey(...args), false);
    }
    assert.deepEqual(selectedDaihonEdit('試してみてます。', null, undefined, 'a'),
        { value: '試してみてます。a', start: 9, end: 9 });
    assert.deepEqual(selectedDaihonEdit('今日は晴れ',
        [{ text: '今日' }, { text: 'は' }, { text: '晴れ' }], { a: 0, b: 1 }, 'a'),
    { value: 'a晴れ', start: 1, end: 1 });
    assert.match(transcript, /window\.addEventListener\('keydown', selectedTyping, true\)/);
    assert.match(transcript, /selectedDaihonEdit\(row\.text, row\.words/);
});

test('素材の新しい操作ボタンでは Space を編集へ渡さず、ほかのボタンの印字は従来どおり', () => {
    const ts = require('typescript');
    const start = transcript.indexOf('    protected handleSelectedTyping(');
    const end = transcript.indexOf('    protected selectionRows(', start);
    assert.ok(start >= 0 && end > start);
    class Target {
        constructor(className, parent = null) { this.className = className; this.parent = parent; }
        closest(selector) {
            const names = [...selector.matchAll(/\.([\w-]+)/gu)].map(match => match[1]);
            for (let node = this; node; node = node.parent) {
                if (names.includes(node.className)) return node;
            }
            return null;
        }
    }
    const compiled = ts.transpileModule(`class Harness { ${transcript.slice(start, end)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const Harness = new Function('Element', 'isDaihonCompositionStart', 'isPrintableDaihonKey',
        'selectedDaihonEdit', `${compiled}; return Harness;`)(
        Target, isDaihonCompositionStart, isPrintableDaihonKey, selectedDaihonEdit);
    const widget = new Harness();
    let edits = 0;
    Object.assign(widget, {
        node: { contains: () => true }, rows: [{ id: 'a', text: '本文', words: null }],
        selection: { selected: ['a'] }, wordRanges: [], editing: undefined,
        startEdit() { edits++; this.editing = { input: { value: '', setSelectionRange() {} } }; }
    });
    const send = (target, key = ' ') => {
        const result = { prevented: false, stopped: false };
        widget.handleSelectedTyping({ target, key, keyCode: key === ' ' ? 32 : 65,
            isComposing: false, altKey: false, ctrlKey: false, metaKey: false,
            preventDefault() { result.prevented = true; }, stopPropagation() { result.stopped = true; } });
        return result;
    };
    for (const selection of [{ selected: ['a'] }, { selected: [], wordRanges: [{ row: 'a', a: 0, b: 0 }] }]) {
        widget.selection = { selected: selection.selected };
        widget.wordRanges = selection.wordRanges ?? [];
        for (const className of ['akari-daihon-source-heading', 'akari-daihon-source-toggle',
            'akari-daihon-source-all']) {
            assert.deepEqual(send(new Target('arrow', new Target(className))),
                { prevented: false, stopped: false });
            assert.equal(edits, 0);
        }
    }
    widget.wordRanges = [];
    widget.selection = { selected: ['a'] };
    assert.deepEqual(send(new Target('old-button'), 'a'), { prevented: true, stopped: true });
    assert.equal(edits, 1);
});

test('IME の Process / keyCode 229 は既定動作を止めず編集欄へ移し、行末か選択語を変換対象にする', () => {
    assert.equal(isDaihonCompositionStart('Process', 0), true);
    assert.equal(isDaihonCompositionStart('Unidentified', 229), true);
    assert.equal(isDaihonCompositionStart('a', 65), false);
    assert.deepEqual(selectedDaihonEdit('試してみてます。', null, undefined),
        { value: '試してみてます。', start: 8, end: 8 });
    assert.deepEqual(selectedDaihonEdit('Xみてます。',
        [{ text: 'X' }, { text: 'みてます。' }], { a: 0, b: 0 }),
    { value: 'Xみてます。', start: 0, end: 1 });
    assert.match(transcript, /if \(!compositionStart\) event\.preventDefault\(\)/);
    assert.match(transcript, /input\.setSelectionRange\(edit\.start, edit\.end\)/);
});

test('編集の取消・確定後は選択を維持し、BODY に落ちたフォーカスを行リストへ戻す', () => {
    const editEnd = transcript.slice(transcript.indexOf('protected finishEdit('),
        transcript.indexOf('protected replaceRenderedRow('));
    assert.match(editEnd, /this\.editing = undefined;[\s\S]*this\.restoreRowsFocusAfterEdit\(\)/);
    assert.match(transcript, /document\.activeElement === document\.body\) this\.focusRows\(\)/);
    assert.match(transcript, /action === 'cancel'[\s\S]*?state\.cancelled = true;\s*input\.blur\(\);\s*void this\.finishEdit\(state\)/);
});

test('長い選択語は省略記号を付け、短い選択語は全文を表示する', () => {
    assert.equal(wordSelectionHeading('動画編集ツールを作る'), '単語「動画編集ツール…」を選択中');
    assert.equal(wordSelectionHeading('動画編集ツールを作る', 4), '単語「動画編集…」を選択中');
    assert.equal(wordSelectionHeading('今日は'), '単語「今日は」を選択中');
    assert.match(transcript, /title\.textContent = wordSelectionHeading\(summary\.text, bar\.clientWidth > 480 \? 7 : 4\)/);
});

test('強調だけ変わった行も再描画され、保存直後に本文のプリセット印が更新される', () => {
    const before = new Map([['c1', [undefined, undefined]], ['c2', ['neon']]]);
    const after = new Map([['c1', ['emphasis-red', undefined]], ['c2', ['neon']]]);
    assert.deepEqual(changedWordPresetRowIds(before, after), ['c1']);
    assert.deepEqual(changedWordPresetRowIds(after, before), ['c1']);
    assert.deepEqual(changedWordPresetRowIds(after, new Map(after)), []);
    assert.match(transcript, /changedPresets\.has\(row\.id\)/);
    assert.match(transcript, /this\.word\(word\.text, index, row\.id, this\.wordPresetByRowId\.get\(row\.id\)\?\.\[index\]\)/);
    assert.match(transcript, /await settleCaptionCommand\(result, \{ reload: async \(\) => \{ await this\.reload\(\); \}/);
    assert.match(transcript, /this\.renderRows\(next, cutSourceChanged, changedWordMarkRows\(previousWordMarks, this\.wordPresetByRowId\)\)/);
    const start = transcript.indexOf('    protected resolveWordPresets(');
    const end = transcript.indexOf('    protected async loadSilences(', start);
    const ts = require('typescript');
    const compiled = ts.transpileModule(`class Harness { ${transcript.slice(start, end)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const Harness = new Function(`${compiled}; return Harness;`)();
    const presets = new Harness().resolveWordPresets({ emphasis_words: [{
        src: 'sample', t_start: 2.35, t_end: 2.75, style_preset: 'emphasis-red'
    }] }, [{ id: 'c1', src: 'sample', start: 2, end: 3, text: '今日は',
        displayText: '今日は！', timeDomain: 'source', words: [{ text: '今日は', start: 2.35, end: 2.75 }] }]);
    assert.deepEqual(presets.get('c1'), ['emphasis-red']);
});

test('強調データの更新通知がプレビューの色・太さを運ぶ', () => {
    assert.match(transcript, /src: this\.sourceIdForRow\(row\)/);
    assert.match(previewHost, /return normalizePreviewEmphasisWords\(value, output\)/);
    assert.match(previewHost, /type: 'akari-preview-captions-update', captions: nextCaptions, emphasisWords/);
    assert.match(preview, /emphasisWords = message\.emphasisWords/);
    const start = preview.indexOf('const emphasisPresets =');
    const end = preview.indexOf('const renderCaptionToken =', start);
    assert.ok(start >= 0 && end > start);
    const renderer = preview.slice(start, end).replace('${JSON.stringify(TEXTSTYLE_CATALOG)}',
        JSON.stringify({ 'emphasis-red': { style: { color: '#ff1744', weight: 700 } } }))
        .replace('${JSON.stringify(CAPTION_INHERITED_EMPHASIS_VARS)}', '[]');
    const html = vm.runInNewContext(`${renderer}\nrenderEmphasisCaptionToken(
        { text: '今日は', start: 2.35, end: 2.75 }, 2,
        { id: 'e-0001', word: '今日は', t_start: 2.35, t_end: 2.75,
          emotion: 'neutral', style_preset: 'emphasis-red' })`, {
        escapeCaptionHtml: text => text,
        formatCaptionSeconds: seconds => String(seconds)
    });
    assert.match(html, /color:#ff1744/);
    assert.match(html, /font-weight:700/);
});

test('映像カット範囲を開く時にドックを閉じ、操作可能な位置へ表示する', () => {
    assert.deepEqual(defaultCutRange({ kind: 'word', start: 2.35, end: 2.75,
        limitStart: 2, limitEnd: 3 }, 0.15), { from: 2.35, to: 2.75 });
    assert.match(transcript, /this\.closeDock\(\);\s*rowElement\.after\(root\)/);
    assert.match(transcript, /root\.scrollIntoView\(\{ block: 'center', behavior: 'auto' \}\)/);
    assert.match(transcript, /this\.openCutRangeEditor\(span\.row/);
});
