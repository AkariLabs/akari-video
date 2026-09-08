import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    applyCaptionLineOps,
    parseCaptions,
    removeCaptionWordsLine,
    serializeCaptions
} = require('../lib/browser/caption-store.js');
const { diffCaptionLines } = require('@akari-video/edit-store/lib/caption-line-diff');

// widget の DOM は使わず、「編集後の表示行 → diffCaptionLines → applyCaptionLineOps →
// captions.json へ書く」という書き戻し関数の合成だけを一時ファイルに対して検証する
// （task 2026-09-08-caption-line-ops 指示 18）。
function createProject(captions) {
    const directory = mkdtempSync(join(tmpdir(), 'akari-caption-line-ops-'));
    const path = join(directory, 'captions.json');
    writeFileSync(path, serializeCaptions(captions), 'utf8');
    return { directory, path };
}

const line = (id, start, end, text, extra = {}) => ({
    id,
    start,
    end,
    text,
    speaker: null,
    sourceRef: { segment: 0 },
    edited: false,
    ...extra
});

/** 現在の captions.json を読み、「1 行 = 1 字幕」の表示行を作る（widget の baselineLines と同じ）。 */
function readState(path) {
    const source = readFileSync(path, 'utf8');
    // 毎回「parseCaptions が通る JSON のまま」であることを確かめる
    JSON.parse(source);
    const parsed = parseCaptions(source);
    assert.deepEqual(parsed.warnings, [], '読み直しで警告が出ないこと');
    return { source, captions: parsed.captions, lines: parsed.captions.map(caption => caption.text) };
}

/** 編集後の表示行を渡して 1 回保存する（widget の onEditorChanged → saveLineOps 相当）。 */
function save(path, nextLines, options) {
    const state = readState(path);
    const ops = diffCaptionLines(state.lines, nextLines, state.captions);
    const result = applyCaptionLineOps(state.source, ops, options);
    writeFileSync(path, result.source, 'utf8');
    return { ops, result, before: state };
}

test('split → merge → remove → insert を順に適用しても captions.json は読める JSON のままで、件数と時刻が期待どおり動く', () => {
    const project = createProject([
        line('c-0001', 0, 2, 'こんにちは'),
        line('c-0002', 2, 6, 'きょうは いい 天気ですね'),
        line('c-0003', 6, 8, 'またね')
    ]);
    try {
        assert.equal(readState(project.path).captions.length, 3);

        // 1) 分割: c-0002 を 2 行へ。文字数比 4 : 8 で [2, 6] を按分する
        const split = save(project.path, ['こんにちは', 'きょうは', 'いい 天気ですね', 'またね']);
        assert.deepEqual(split.ops, [
            { kind: 'split', id: 'c-0002', texts: ['きょうは', 'いい 天気ですね'] }
        ]);
        assert.deepEqual(split.result.counts, { replace: 0, split: 1, merge: 0, remove: 0, insert: 0 });
        assert.deepEqual(split.result.notices, []);
        const afterSplit = readState(project.path);
        assert.equal(afterSplit.captions.length, 4);
        assert.deepEqual(
            afterSplit.captions.map(caption => [caption.id, caption.start, caption.end]),
            [['c-0001', 0, 2], ['c-0002', 2, 3.333], ['c-0004', 3.333, 6], ['c-0003', 6, 8]]
        );

        // 2) 結合: 先頭 2 行を 1 行へ。先頭の start と末尾の end を使う
        const merge = save(project.path, ['こんにちは きょうは', 'いい 天気ですね', 'またね']);
        assert.deepEqual(merge.ops, [
            { kind: 'merge', ids: ['c-0001', 'c-0002'], text: 'こんにちは きょうは' }
        ]);
        assert.deepEqual(merge.result.counts, { replace: 0, split: 0, merge: 1, remove: 0, insert: 0 });
        const afterMerge = readState(project.path);
        assert.equal(afterMerge.captions.length, 3);
        assert.deepEqual(
            afterMerge.captions.map(caption => [caption.id, caption.start, caption.end]),
            [['c-0001', 0, 3.333], ['c-0004', 3.333, 6], ['c-0003', 6, 8]]
        );

        // 3) 削除: 末尾行を消す。前後の時刻は動かさない
        const remove = save(project.path, ['こんにちは きょうは', 'いい 天気ですね']);
        assert.deepEqual(remove.ops, [{ kind: 'remove', id: 'c-0003' }]);
        assert.deepEqual(remove.result.counts, { replace: 0, split: 0, merge: 0, remove: 1, insert: 0 });
        const afterRemove = readState(project.path);
        assert.equal(afterRemove.captions.length, 2);
        assert.deepEqual(
            afterRemove.captions.map(caption => [caption.id, caption.start, caption.end]),
            [['c-0001', 0, 3.333], ['c-0004', 3.333, 6]]
        );

        // 4) 追加: 末尾へ 1 行。次行が無いので既定尺 1 秒で置く
        const insert = save(project.path, ['こんにちは きょうは', 'いい 天気ですね', 'ではまた']);
        assert.deepEqual(insert.ops, [{ kind: 'insert', afterId: 'c-0004', text: 'ではまた' }]);
        assert.deepEqual(insert.result.counts, { replace: 0, split: 0, merge: 0, remove: 0, insert: 1 });
        const afterInsert = readState(project.path);
        assert.equal(afterInsert.captions.length, 3);
        assert.deepEqual(
            afterInsert.captions.map(caption => [caption.id, caption.start, caption.end]),
            [['c-0001', 0, 3.333], ['c-0004', 3.333, 6], ['c-0005', 6, 7]]
        );

        // 時刻は最後まで単調増加（重なりも逆順も作らない）
        let previousEnd = -Infinity;
        for (const caption of afterInsert.captions) {
            assert.ok(caption.start >= previousEnd, `${caption.id} の start が前の end を下回らない`);
            assert.ok(caption.end > caption.start, `${caption.id} の end は start より後`);
            previousEnd = caption.end;
        }
        // 1 レコード 1 物理行の契約（replaceCaptionLine 系の行手術）は保たれている
        const body = readFileSync(project.path, 'utf8');
        assert.equal(body.split('\n').filter(row => row.includes('"id"')).length, 3);
    } finally {
        rmSync(project.directory, { recursive: true, force: true });
    }
});

test('split は分割後の行が 0.2 秒を持てないとき本文を変えずに理由だけ返す', () => {
    const project = createProject([
        line('c-0001', 0, 0.3, 'みじかい'),
        line('c-0002', 1, 2, 'つぎ')
    ]);
    try {
        const before = readFileSync(project.path, 'utf8');
        const saved = save(project.path, ['みじ', 'かい', 'つぎ']);
        assert.deepEqual(saved.ops, [{ kind: 'split', id: 'c-0001', texts: ['みじ', 'かい'] }]);
        assert.equal(saved.result.applied, 0);
        assert.deepEqual(saved.result.notices, ['この行は短すぎて分割できません。']);
        assert.equal(readFileSync(project.path, 'utf8'), before, '拒否したときは本文を変えない');
    } finally {
        rmSync(project.directory, { recursive: true, force: true });
    }
});

test('insert は前後に隙間が無いとき拒否し、他の操作は保存する', () => {
    const project = createProject([
        line('c-0001', 0, 2, 'ひとつめ'),
        line('c-0002', 2, 4, 'ふたつめ')
    ]);
    try {
        // 隙間ゼロの間へ差し込む（拒否）
        const rejected = save(project.path, ['ひとつめ', 'あいだ', 'ふたつめ']);
        assert.deepEqual(rejected.ops, [{ kind: 'insert', afterId: 'c-0001', text: 'あいだ' }]);
        assert.equal(rejected.result.applied, 0);
        assert.deepEqual(rejected.result.notices, ['ここには字幕を追加できません（前後に隙間がありません）。']);
        assert.equal(readState(project.path).captions.length, 2);

        // 末尾（隙間の上限が無い）への追加は通る
        const accepted = save(project.path, ['ひとつめ', 'ふたつめ', 'みっつめ']);
        assert.equal(accepted.result.applied, 1);
        assert.deepEqual(readState(project.path).captions.map(caption => caption.id), [
            'c-0001', 'c-0002', 'c-0003'
        ]);
    } finally {
        rmSync(project.directory, { recursive: true, force: true });
    }
});

test('split は行固有スタイルを全ての分割後行へ複製し、words / display_text は引き継がない', () => {
    const project = createProject([
        line('c-0001', 0, 4, 'まえ うしろ', {
            textStyle: { color: '#FF0000', size_px: 48 },
            words: [
                { start: 0, end: 2, text: 'まえ' },
                { start: 2, end: 4, text: 'うしろ' }
            ],
            displayText: 'まえうしろ'
        })
    ]);
    try {
        const saved = save(project.path, ['まえ', 'うしろ']);
        assert.equal(saved.result.counts.split, 1);
        const records = JSON.parse(readFileSync(project.path, 'utf8'));
        assert.equal(records.length, 2);
        for (const record of records) {
            assert.deepEqual(record.text_style, { color: '#FF0000', size_px: 48 });
            assert.equal(record.words, undefined, 'words は捨てる（指示 C-9）');
            assert.equal(record.display_text, undefined);
            assert.equal(record.edited, true);
        }
        assert.deepEqual(records.map(record => [record.id, record.start, record.end]), [
            ['c-0001', 0, 1.6], ['c-0002', 1.6, 4]
        ]);
    } finally {
        rmSync(project.directory, { recursive: true, force: true });
    }
});

test('merge は先頭行のスタイルを残し、捨てた側と食い違うときだけ理由を返す', () => {
    const styled = () => createProject([
        line('c-0001', 0, 2, 'まえ', { textStyle: { color: '#FF0000' } }),
        line('c-0002', 2, 4, 'うしろ', { textStyle: { color: '#0000FF' } })
    ]);
    const differing = styled();
    try {
        const saved = save(differing.path, ['まえ うしろ']);
        assert.deepEqual(saved.ops, [{ kind: 'merge', ids: ['c-0001', 'c-0002'], text: 'まえ うしろ' }]);
        assert.deepEqual(saved.result.notices, ['結合したため 2 行目以降のスタイル指定は失われました。']);
        const records = JSON.parse(readFileSync(differing.path, 'utf8'));
        assert.equal(records.length, 1);
        assert.deepEqual(records[0].text_style, { color: '#FF0000' });
        assert.deepEqual([records[0].start, records[0].end], [0, 4]);
        assert.equal(records[0].words, undefined, '結合後は words を持たない（指示 C-9）');
    } finally {
        rmSync(differing.directory, { recursive: true, force: true });
    }

    const same = createProject([
        line('c-0001', 0, 2, 'まえ', { textStyle: { color: '#FF0000' } }),
        line('c-0002', 2, 4, 'うしろ', { textStyle: { color: '#FF0000' } })
    ]);
    try {
        const saved = save(same.path, ['まえ うしろ']);
        assert.deepEqual(saved.result.notices, [], 'スタイルが同じなら黙って結合する');
    } finally {
        rmSync(same.directory, { recursive: true, force: true });
    }
});

test('空行は保存せず理由を返し、他の行の変更は保存する', () => {
    const project = createProject([
        line('c-0001', 0, 2, 'ひとつめ'),
        line('c-0002', 4, 6, 'ふたつめ')
    ]);
    try {
        const saved = save(project.path, ['ひとつめ', '', 'ふたつめ']);
        assert.equal(saved.result.applied, 0);
        assert.deepEqual(saved.result.notices, ['空の行は字幕になりません。文字を入れると保存します。']);
        assert.equal(readState(project.path).captions.length, 2);
    } finally {
        rmSync(project.directory, { recursive: true, force: true });
    }
});

test('object ルート（default_text_style 付き）でも行数の変わる編集を書き戻せる', () => {
    const directory = mkdtempSync(join(tmpdir(), 'akari-caption-line-ops-object-'));
    const path = join(directory, 'captions.json');
    writeFileSync(path, serializeCaptions([
        line('c-0001', 0, 4, 'まえ うしろ'),
        line('c-0002', 5, 7, 'さいご')
    ], { root: 'object', defaultTextStyle: { color: '#FFFFFF' } }), 'utf8');
    try {
        const saved = save(path, ['まえ', 'うしろ', 'さいご']);
        assert.equal(saved.result.counts.split, 1);
        const root = JSON.parse(readFileSync(path, 'utf8'));
        assert.deepEqual(root.default_text_style, { color: '#FFFFFF' });
        assert.deepEqual(root.captions.map(record => record.id), ['c-0001', 'c-0003', 'c-0002']);
        assert.equal(readState(path).captions.length, 3);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('removeCaptionWordsLine は対象 1 行の words だけを落とし、無い行では本文を変えない', () => {
    const source = serializeCaptions([
        line('c-0001', 0, 3, 'あいう', {
            words: [
                { start: 0, end: 1, text: 'あ' },
                { start: 1, end: 3, text: 'いう' }
            ]
        }),
        line('c-0002', 3, 5, 'つぎ')
    ]);
    const stripped = removeCaptionWordsLine(source, 'c-0001');

    assert.equal(/"words"/.test(source), true);
    assert.equal(/"words"/.test(stripped), false);
    assert.equal(parseCaptions(stripped).captions.length, 2);
    assert.equal(stripped.split('\n').length, source.split('\n').length, '1 レコード 1 物理行のまま');
    assert.equal(removeCaptionWordsLine(stripped, 'c-0001'), stripped, '冪等');
    assert.equal(removeCaptionWordsLine(source, 'c-0002'), source, 'words の無い行は本文不変');
    assert.throws(() => removeCaptionWordsLine(source, 'c-9999'), /字幕 c-9999 が字幕データにありません。/);
});
