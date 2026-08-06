# Font カタログ

特定の書体そのもの（グリフ）は自然言語から生成不能なため、常に取得先の索引（`remote: true`）として扱います。`source.url` は取得元の記録です。

**二層構成（2026-07-23 追記）**: 日本語テロップの Mac/Windows パリティ確保のため、同梱済みエントリは
実体（フォントバイナリ + OFL-1.1 ライセンスファイル）を `assets/font/<id>/` に同梱済みです。
`catalog/font/<id>/meta.json`（このカタログ）は索引として残り、`assets/font/<id>/` が実体の在り処です。
`remote: true` は「`catalog/font/<id>/` ディレクトリ自体は実体を持たない」という従来通りの意味で維持しており、
`validate-asset.mjs` は変更なしで通過します（実体の有無は `assets/font/<id>/` を直接参照して確認）。
他カテゴリ（3d/audio/broll 等）は引き続き「索引のみ・実体は各自取得」のままです。

## 分類の凡例（2026-08-05 拡充）

| 分類 | 意味 |
|---|---|
| **同梱済み** | 実体を `assets/font/` にバンドル。全環境で同じ字形（bake 決定論の対象） |
| **参照（OFL・同梱昇格可）** | 無料・再配布可（OFL-1.1）。現状は索引のみで実体は各自取得。裁定があれば `assets/font/` へ昇格できる |
| **参照配布のみ（無料・再配布不可）** | 使用は無料・商用可だが、フォントファイルの再配布が禁止。索引のみ・取得は本人承認のうえ配布元から |
| **各自入手（有料/サブスク）** | 「持っている環境でだけ効く」。fontFamily ツマミに選択肢はあるが、未所持環境ではフォールバック書体に落ちる |

- 同梱以外のフォントはレンダリングが環境依存になる（インストール済みならローカルでは bake でも効くが、マシン間の字形パリティは保証されない）
- 参照系フォントの CSS family 名は代表的な表示名で書いてある。環境によって内部名が異なる場合（ウェイト別 family 等）は、実際の表示名を fontFamily ツマミへ直接指定する
- macOS 同梱の **ヒラギノ角ゴシック**（`'Hiragino Sans'`）はカタログ登録なしで fontFamily ツマミの選択肢に含めてある（Mac では常に効く・再配布不可のため索引も持たない）

## エントリ — 同梱済み（9 家族）

- [noto-sans-jp](./noto-sans-jp/meta.json) — Google Fonts 定番の日本語ゴシック体。可変フォント（wght 100〜900）で高可読性の標準選択肢。テロップ・字幕・UI 表示に汎用的に使える。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/noto-sans-jp/NotoSansJP-Variable.ttf`）
- [mplus-rounded-1c](./mplus-rounded-1c/meta.json) — 丸みを帯びたやわらかい印象の日本語ゴシック体。VLOG・エンタメ・カジュアルなテロップ見出しに。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/mplus-rounded-1c/`、Medium・ExtraBold・Black の3ウェイトのみ静的同梱）
- [noto-serif-jp](./noto-serif-jp/meta.json) — Google Fonts 定番の日本語明朝体。可変フォント（wght 100〜900）で Hiragino Mincho ProN 相当の明朝トーンを再現。源ノ明朝（Source Han Serif）と同一書体系譜。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/noto-serif-jp/NotoSerifJP-Variable.ttf`）
- [biz-udgothic](./biz-udgothic/meta.json) — UD 系日本語ゴシック。ニュース・報道・情報系字幕の定番トーン。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/biz-udgothic/`、Regular・Bold）
- [dela-gothic-one](./dela-gothic-one/meta.json) — 極太ディスプレイゴシック。サムネ級の一撃見出しに。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/dela-gothic-one/`、単ウェイト書体）
- [zen-maru-gothic](./zen-maru-gothic/meta.json) — 落ち着いた骨格の丸ゴシック。やさしい・ほっこり系に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/zen-maru-gothic/`、Regular・Bold）
- [shippori-mincho](./shippori-mincho/meta.json) — ディスプレイ寄りの明朝。シネマ・和風・決め台詞に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/shippori-mincho/`、Regular）
- [dotgothic16](./dotgothic16/meta.json) — ドット絵ゴシック。レトロゲーム・8bit 演出に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/dotgothic16/`、単ウェイト書体）
- [klee-one](./klee-one/meta.json) — 手書き教科書体。手紙風・やさしいナレーション風に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/klee-one/`、Regular）

## エントリ — 参照（OFL・同梱昇格可）

無料・商用可・再配布可。現状は索引のみ（2026-08-05 オーナー裁定「まずカタログ参照のみ」）。

- [rocknroll-one](./rocknroll-one/meta.json) — ポップなラウンドディスプレイゴシック（Fontworks → Google Fonts）。ツッコミ・元気系。（OFL-1.1 / direct）
- [reggae-one](./reggae-one/meta.json) — 極太の勢いあるディスプレイ書体（Fontworks → Google Fonts）。強ツッコミ・叫び。（OFL-1.1 / direct）
- [mplus-1p](./mplus-1p/meta.json) — M+ 系のニュートラルなゴシック。丸ゴでない素直なポップ系・情報系。（OFL-1.1 / direct）
- [mgen-plus](./mgen-plus/meta.json) — M+ + Noto Sans CJK 合成で漢字を補完した Mgen+。（OFL-1.1 / direct）
- [zero-gothic](./zero-gothic/meta.json) — ガラス亀裂入り極太ゴシック「零ゴシック」。衝撃・ホラー系強調。（OFL-1.1 / login: BOOTH）
- [isego](./isego/meta.json) — 異世界転移の歪み「異世ゴ」。違和感・夢・酩酊演出。（OFL-1.1 / login: BOOTH）
- [corporate-logo-rounded](./corporate-logo-rounded/meta.json) — ロゴ向け角丸ゴシック「コーポレート・ロゴ（ラウンド）ver3」。（OFL-1.1 / direct）

## エントリ — 参照配布のみ（無料・再配布不可）

使用は無料・商用可（各配布元規約）。フォントファイルの再配布・同梱は不可のため、取得は本人承認のうえ配布元から。

- [851-chikara-dzuyoku](./851-chikara-dzuyoku/meta.json) — 太マジック手書き「851チカラヅヨク」。ツッコミテロップの超定番。（無料・商用可 / direct）
- [851-chikara-yowaku](./851-chikara-yowaku/meta.json) — ヨレ弱々手書き「851チカラヨワク」。脱力・自虐ツッコミ。（無料・商用可 / direct）
- [ranobe-pop](./ranobe-pop/meta.json) — ラノベ風ポップ体「07ラノベPOP」（fontna）。ポップ系定番。（無料・商用可 / direct）
- [check-and-oudan](./check-and-oudan/meta.json) — ウルトラクイズ風「チェックアンド横断フォント」。クイズ・レトロ演出。（無料 / direct・規約は取得時に最終確認）
- [togebara](./togebara/meta.json) — 棘のあるアンチック「棘薔薇フォント」。高貴・ゴシックホラー。（無料・商用可 / direct・規約は取得時に最終確認）
- [wanpaku-ruika](./wanpaku-ruika/meta.json) — 元気ポップ「わんぱくルイカ」無料お試し版（教育漢字 1,026 字まで・フル版有料）。（無料・商用可 / login）
- [ruika](./ruika/meta.json) — くっきりポップ「ルイカ」無料お試し版（教育漢字まで・フル版有料）。（無料・商用可 / login）

## エントリ — 各自入手（有料/サブスク・持っている環境でだけ効く）

索引のみ。購入・契約は本人が行う。fontFamily ツマミの選択肢には含まれており、インストール済み環境でのみ反映される。

- [vdl-v7-mincho](./vdl-v7-mincho/meta.json) — 映像テロップ定番明朝「VDL V7明朝」（視覚デザイン研究所）。（有料 / purchase）
- [vdl-logojr-black](./vdl-logojr-black/meta.json) — 極太ロゴゴシック「VDL ロゴJr ブラック」。サムネ級強調。（有料 / purchase）
- [ta-f1-blockline](./ta-f1-blockline/meta.json) — ブロック + ライン構成「TA-F1ブロックライン」（FONT1000）。（有料 / purchase）
- [ta-engeifude](./ta-engeifude/meta.json) — 寄席文字風筆書体「TA演芸筆」。（有料 / purchase）
- [ta-fugafude](./ta-fugafude/meta.json) — 流麗な筆書体「TA風雅筆」。（有料 / purchase）
- [kso-kokuryuso](./kso-kokuryuso/meta.json) — 毛筆デザイン書体「KSO黒龍爽」（昭和書体）。迫力の筆文字。（有料 / purchase・1 ライセンス 1 PC）
- [ab-kirigirisu](./ab-kirigirisu/meta.json) — 切り文字風見出し「AB-kirigirisu」。Adobe CC サブスク環境で利用可。（サブスク / login）
