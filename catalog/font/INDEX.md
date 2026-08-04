# Font カタログ

特定の書体そのもの（グリフ）は自然言語から生成不能なため、常に取得先の索引（`remote: true`）として扱います。`source.url` は取得元の記録です。

**二層構成（2026-07-23 追記）**: 日本語テロップの Mac/Windows パリティ確保のため、以下3エントリは
実体（フォントバイナリ + OFL-1.1 ライセンスファイル）を `assets/font/<id>/` に同梱済みです。
`catalog/font/<id>/meta.json`（このカタログ）は索引として残り、`assets/font/<id>/` が実体の在り処です。
`remote: true` は「`catalog/font/<id>/` ディレクトリ自体は実体を持たない」という従来通りの意味で維持しており、
`validate-asset.mjs` は変更なしで通過します（実体の有無は `assets/font/<id>/` を直接参照して確認）。
他カテゴリ（3d/audio/broll 等）は引き続き「索引のみ・実体は各自取得」のままです。

## エントリ

- [noto-sans-jp](./noto-sans-jp/meta.json) — Google Fonts 定番の日本語ゴシック体。可変フォント（wght 100〜900）で高可読性の標準選択肢。テロップ・字幕・UI 表示に汎用的に使える。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/noto-sans-jp/NotoSansJP-Variable.ttf`）
- [mplus-rounded-1c](./mplus-rounded-1c/meta.json) — 丸みを帯びたやわらかい印象の日本語ゴシック体。VLOG・エンタメ・カジュアルなテロップ見出しに。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/mplus-rounded-1c/`、Medium・ExtraBold・Black の3ウェイトのみ静的同梱）
- [noto-serif-jp](./noto-serif-jp/meta.json) — Google Fonts 定番の日本語明朝体。可変フォント（wght 100〜900）で Hiragino Mincho ProN 相当の明朝トーンを再現。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/noto-serif-jp/NotoSerifJP-Variable.ttf`）
- [biz-udgothic](./biz-udgothic/meta.json) — UD 系日本語ゴシック。ニュース・報道・情報系字幕の定番トーン。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/biz-udgothic/`、Regular・Bold）
- [dela-gothic-one](./dela-gothic-one/meta.json) — 極太ディスプレイゴシック。サムネ級の一撃見出しに。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/dela-gothic-one/`、単ウェイト書体）
- [zen-maru-gothic](./zen-maru-gothic/meta.json) — 落ち着いた骨格の丸ゴシック。やさしい・ほっこり系に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/zen-maru-gothic/`、Regular・Bold）
- [shippori-mincho](./shippori-mincho/meta.json) — ディスプレイ寄りの明朝。シネマ・和風・決め台詞に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/shippori-mincho/`、Regular）
- [dotgothic16](./dotgothic16/meta.json) — ドット絵ゴシック。レトロゲーム・8bit 演出に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/dotgothic16/`、単ウェイト書体）
- [klee-one](./klee-one/meta.json) — 手書き教科書体。手紙風・やさしいナレーション風に。（license: OFL-1.1 / acquisition: direct / 実体: `assets/font/klee-one/`、Regular）
