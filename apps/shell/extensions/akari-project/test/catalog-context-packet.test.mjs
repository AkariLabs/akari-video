import test from 'node:test';
import assert from 'node:assert/strict';
import { composeCatalogImportPrompt, composeCatalogAskAgentPrompt, composeCatalogPackImportPrompt } from '../lib/common/catalog-context-packet.js';

// カード動詞2本（取り込む/頼む）が組み立てるパケットの単体テスト。
// agent-context-packet.ts の汎用 composer を再利用しているだけであることを
// カタログ固有の語彙（id/category/title/source.url/license.spdx/when_to_use）
// の有無パターンで確認する。

const FULL_ITEM = {
    id: 'vintage-camera',
    category: '3d',
    title: 'ヴィンテージカメラ 3D モデル',
    when_to_use: 'レトロ・アナログ演出のプロダクト紹介、写真/映像機材を扱う動画のヒーローショット',
    license: { spdx: 'CC0-1.0' },
    source: { url: 'https://polyhaven.com/a/Camera_01', preview_url: 'https://cdn.polyhaven.com/x.png' }
};

const MINIMAL_ITEM = { id: 'noto-sans-jp', category: 'font', title: 'Noto Sans JP' };

test('composeCatalogImportPrompt: 固定パケットに id/category/title/source.url/license.spdx + 依頼文が全て出る', () => {
    const packet = composeCatalogImportPrompt(FULL_ITEM);
    assert.equal(
        packet,
        '【カタログ素材】vintage-camera（category 3d・title ヴィンテージカメラ 3D モデル・source: https://polyhaven.com/a/Camera_01・license: CC0-1.0）について: この素材をカタログの参照情報から取得し、ライセンス表記を確認の上プロジェクトへ配置してください（setup-library 系スキルの手順に従う）'
    );
});

test('composeCatalogImportPrompt: source.url/license.spdx が無い項目は要素ごと出ない（欠落で例外にならない）', () => {
    const packet = composeCatalogImportPrompt(MINIMAL_ITEM);
    assert.equal(
        packet,
        '【カタログ素材】noto-sans-jp（category font・title Noto Sans JP）について: この素材をカタログの参照情報から取得し、ライセンス表記を確認の上プロジェクトへ配置してください（setup-library 系スキルの手順に従う）'
    );
    assert.equal(packet.includes('source:'), false);
    assert.equal(packet.includes('license:'), false);
});

test('composeCatalogAskAgentPrompt: 同要素 + when_to_use 先頭1文 + ユーザー入力文', () => {
    const packet = composeCatalogAskAgentPrompt(FULL_ITEM, 'この素材で何をしますか');
    assert.equal(
        packet,
        '【カタログ素材】vintage-camera（category 3d・title ヴィンテージカメラ 3D モデル・source: https://polyhaven.com/a/Camera_01・license: CC0-1.0・用途: レトロ・アナログ演出のプロダクト紹介、写真/映像機材を扱う動画のヒーローショット）について: この素材で何をしますか'
    );
});

test('composeCatalogAskAgentPrompt: when_to_use が句点区切りの複文でも先頭の1文だけを使う', () => {
    const item = {
        id: 'noto-sans-jp',
        category: 'font',
        title: 'Noto Sans JP',
        when_to_use: '特定の作風を狙わず、まず崩れなく読める日本語テロップ・字幕・UI テキストが欲しいシーン。企業紹介・解説動画など幅広いトーンの標準書体として'
    };
    const packet = composeCatalogAskAgentPrompt(item, '検討したい');
    assert.equal(
        packet,
        '【カタログ素材】noto-sans-jp（category font・title Noto Sans JP・用途: 特定の作風を狙わず、まず崩れなく読める日本語テロップ・字幕・UI テキストが欲しいシーン。）について: 検討したい'
    );
    assert.equal(packet.includes('企業紹介'), false, '句点以降（2文目）は含まれてはいけない');
});

test('composeCatalogAskAgentPrompt: when_to_use が無い項目でも用途要素なしで組み立つ', () => {
    const packet = composeCatalogAskAgentPrompt(MINIMAL_ITEM, '色を変えたい');
    assert.equal(packet, '【カタログ素材】noto-sans-jp（category font・title Noto Sans JP）について: 色を変えたい');
    assert.equal(packet.includes('用途:'), false);
});

// composeCatalogPackImportPrompt — パック棚ヘッダ「まとめて取り込む」の定型パケット。

test('composeCatalogPackImportPrompt: パック名 + 対象件数 + 品目一覧（id・category・title）が全て出る', () => {
    const packet = composeCatalogPackImportPrompt('テロップ向け必須フォント 25 選', [
        { id: '851-chikara-dzuyoku', category: 'font', title: '851チカラヅヨク' },
        { id: 'zero-gothic', category: 'font', title: 'ゼロゴシック' }
    ]);
    assert.equal(
        packet,
        '【カタログ素材パック】テロップ向け必須フォント 25 選 — 対象 2 件: 851-chikara-dzuyoku（font・851チカラヅヨク）、zero-gothic（font・ゼロゴシック）について: このパックの未取得の無料素材をまとめて取得し、ライセンス表記を確認の上プロジェクトへ配置してください（setup-library 系スキルの手順に従う）'
    );
});

test('composeCatalogPackImportPrompt: 1 行に畳み込まれる（改行が紛れ込んでも壊れない）', () => {
    const packet = composeCatalogPackImportPrompt('改行\nを含む\nパック名', [
        { id: 'x', category: 'font', title: '改行\nを含む題名' }
    ]);
    assert.equal(packet.includes('\n'), false);
});

test('composeCatalogPackImportPrompt: 対象 0 件でも例外にならない', () => {
    const packet = composeCatalogPackImportPrompt('空パック', []);
    assert.equal(packet.includes('対象 0 件'), true);
});
