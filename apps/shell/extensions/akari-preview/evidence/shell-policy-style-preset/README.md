# shell-policy-style-preset — L1（実機 Electron・CDP）

`display_policy` 付きプロジェクトで、`style_preset` だけを書いた字幕 cue が shell の
出力プレビューでもプリセットどおりに描画されることを実機確認する。

## 走らせ方

```bash
AKARI_REPO=<WORKTREE> \
AKARI_OUT=<WORKTREE>/apps/shell/extensions/akari-preview/evidence/shell-policy-style-preset \
AKARI_FFMPEG=<WORKTREE>/packages/media-bin/vendor/darwin-arm64/ffmpeg \
AKARI_CDP_PORT=9661 \
bash scripts/run-l1.sh
```

`AKARI_HOME` と `--user-data-dir` は `<TMP>` 配下の使い捨てディレクトリを使う。
起動した Electron は PID 指名で終了し、他レーンのプロセスには触れない。

## fixture（`scripts/prepare-fixture.mjs`）

- `display_policy`: `max_line_units: 14 / lines: 1 / wrap: multi`
- `c-0001..c-0004`: プリセットの `style` を `text_style` へ inline した比較用 cue
- `c-0005..c-0008`: `subtitle-news` / `subtitle-variety` / `neon` / `verdict-badge` の
  `style_preset` だけを書いた主役 cue。本票で `applyCaptionStylePresets` を通したため装飾されて出る

## 結果（2026-09-13・L1 PASS / 3 assertions）

| ファイル | 対象 | 実測値 |
|---|---|---|
| `00-style-preset-news.png` | `c-0005` / `subtitle-news`（seek 11.0s） | `速報ニュース` / `background-color: rgb(198, 40, 40)` / `font-size: 56px` / `-webkit-text-stroke-width: 0px` |
| `01-style-preset-variety.png` | `c-0006` / `subtitle-variety`（seek 13.0s） | `ここがすごい！` / `background-color: rgba(0, 0, 0, 0)` / `font-size: 80px` / `-webkit-text-stroke-width: 18px`（= `width_px 9 × 2`） |

前票の `05-style-preset-gap.png` では `style_preset` だけの cue が `font-size: 38px` の
無装飾で出ていたが、本票ではプリセット由来の赤帯・56px・18px ストロークが反映された。
`l1-metrics.json` に算出スタイル、assertion 3/3 PASS、failures 0 を記録した。
