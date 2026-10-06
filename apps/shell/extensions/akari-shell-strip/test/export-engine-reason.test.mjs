import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ExportEventLineParser, exportEngineSummary, japaneseExportReason,
    exportEngineReasonCopyText, lintRefusalSummary, parseExportEventLine, summarizeExportReasons
} from '../lib/common/export-engine-reason.js';

test('GPU 非対応コードの日本語化と未知コードの保持', () => {
    const cases = [
        ['caption-motion-glitch-unsupported', '動き「グリッチ」'],
        ['caption-motion-swing-unsupported', '動き「スイング」'],
        ['caption-motion-typewriter-unsupported', '動き「タイプライター」'],
        ['caption-motion-push-left-unsupported', '動き「左へ押し出す」'],
        ['caption-rich-look-stroke_inner-unsupported', '縁取り（内側）'],
        ['caption-rich-look-fill_gradient-unsupported', 'グラデーション塗り'],
        ['caption-rich-look-extrude-unsupported', '立体押し出し'],
        ['caption-text-style-vertical-unsupported', '縦書き'],
        ['embedded-context', '埋め込みコンテンツ'],
        ['css-3d-backface-hidden', '3D の裏面非表示'],
        ['three-sampled-condition:script-runtime,media-element', '3D のサンプリングで非対応: スクリプト実行、動画・音声要素'],
        ['embedded-context, css-3d-backface-hidden', '埋め込みコンテンツ、3D の裏面非表示'],
        ['three-sampled-condition:future-condition', 'three-sampled-condition:future-condition'],
        ['new-reason', 'new-reason']
    ];
    for (const [code, expected] of cases) assert.equal(japaneseExportReason(code), expected);
});

test('同じ字幕理由をまとめ、全件は保持する', () => {
    const reasons = [
        { kind: 'caption', id: 'a', reason: 'caption-motion-glitch-unsupported' },
        { kind: 'caption', id: 'b', reason: 'caption-motion-glitch-unsupported' },
        { kind: 'caption', id: 'c', reason: 'caption-rich-look-stroke_inner-unsupported' }
    ];
    assert.deepEqual(summarizeExportReasons(reasons), ['字幕 2 件の動き「グリッチ」', '字幕 1 件の縁取り（内側）']);
    assert.equal(exportEngineSummary({ engine: 'osr', reasons }),
        '今回は OSR で書き出しています — 理由: 字幕 2 件の動き「グリッチ」、字幕 1 件の縁取り（内側）');
    assert.equal(exportEngineSummary({ engine: 'gpu', reasons: [] }), 'GPU で書き出しています');
    assert.equal(exportEngineReasonCopyText({ engine: 'osr', reasons }), [
        exportEngineSummary({ engine: 'osr', reasons }),
        '字幕 a: 動き「グリッチ」（caption-motion-glitch-unsupported）',
        '字幕 b: 動き「グリッチ」（caption-motion-glitch-unsupported）',
        '字幕 c: 縁取り（内側）（caption-rich-look-stroke_inner-unsupported）'
    ].join('\n'));
});

test('オーバーレイ理由を件数でまとめ、コピーには全件と元コードを載せる', () => {
    const reasons = [
        { kind: 'overlay', id: 'o1', reason: 'embedded-context' },
        { kind: 'overlay', id: 'o2', reason: 'embedded-context' },
        { kind: 'overlay', id: 'o3', reason: 'css-3d-backface-hidden' }
    ];
    assert.deepEqual(summarizeExportReasons(reasons), [
        'オーバーレイ 2 件の埋め込みコンテンツ', 'オーバーレイ 1 件の3D の裏面非表示'
    ]);
    const text = exportEngineReasonCopyText({ engine: 'osr', reasons });
    assert.equal(text.split('\n').length, 4);
    assert.match(text, /オーバーレイ o2: 埋め込みコンテンツ（embedded-context）/u);
});

test('ENGINE / REFUSED 行をチャンク境界をまたいで読む', () => {
    const parser = new ExportEventLineParser();
    assert.deepEqual(parser.push('ENGINE osr rea'), []);
    const reasons = [{ kind: 'caption', id: 'a', reason: 'caption-motion-glitch-unsupported' }];
    assert.deepEqual(parser.push(`sons=${JSON.stringify(reasons)}\n`), [{ engine: 'osr', reasons }]);
    assert.deepEqual(parser.push('ENGINE gpu\nREFUSED code=lint-not-pass detail={"message":"lint failed"}\n'), [
        { engine: 'gpu', reasons: [] }, { code: 'lint-not-pass', message: 'lint failed' }
    ]);
    assert.equal(parseExportEventLine('ENGINE osr reasons=broken'), undefined);
});

test('lint 拒否はエラーを優先し、無ければ警告を 3 件まで出す', () => {
    assert.equal(lintRefusalSummary([
        { severity: 'warning', message: 'warning' },
        ...['a', 'b', 'c', 'd'].map(message => ({ severity: 'error', message }))
    ]), 'a、b、c');
    assert.equal(lintRefusalSummary([
        { severity: 'warning', message: 'warning 1' }, { severity: 'warning', message: 'warning 2' }
    ]), 'warning 1、warning 2');
    assert.equal(lintRefusalSummary([]), undefined);
});
