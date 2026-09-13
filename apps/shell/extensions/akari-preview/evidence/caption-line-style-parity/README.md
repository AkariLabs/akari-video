# caption-line-style-parity — L1（実機 Electron・CDP）

行の字幕テンプレ（textstyle v0）を `display_policy` 付きプロジェクトへ当てたときに、
shell の出力プレビューが赤帯・実ストローク・発光を書き出しと同じ語彙で描くことの実機確認。

## 走らせ方

```bash
AKARI_REPO=<リポジトリルート> \
AKARI_OUT=<このディレクトリ> \
AKARI_FFMPEG=<repo>/packages/media-bin/vendor/darwin-arm64/ffmpeg \
AKARI_CDP_PORT=9661 \
bash scripts/run-l1.sh
```

`AKARI_HOME` / `--user-data-dir` は `mktemp -d` の使い捨てディレクトリ。
起動した Electron は PID 指名で終了する（他レーンの Electron は触らない）。

## fixture（`scripts/prepare-fixture.mjs`）

- `display_policy`: `max_line_units: 14 / lines: 1 / wrap: multi`（オーナー実プロジェクトと同値）
- `c-0001..c-0004`: `presets/textstyle/<id>.json` の `style` を `text_style` へ inline
  （= `applyCaptionStylePresets` 展開後の形）。`subtitle-news` / `subtitle-variety` / `neon` / `verdict-badge`
- `c-0005..c-0008`: `style_preset` だけを書いた形（下記の申し送り記録用）

## 結果（2026-09-13・L1 PASS / 16 assertions）

| ファイル | 内容 | 実測 |
|---|---|---|
| `00-boot.png` | 起動直後 | — |
| `01-subtitle-news.png` | ニュース風 | `background-color: rgb(198, 40, 40)` / `padding: 16px` / `border-radius: 0px` / `font-size: 56px` |
| `02-subtitle-variety.png` | バラエティ字幕 | `-webkit-text-stroke-width: 18px`（= `width_px 9 × 2`）/ `paint-order: stroke` / `text-shadow: rgba(0,0,0,0.6) 0 6px 6px` |
| `03-neon.png` | ネオン | `text-shadow: rgba(0,229,255,0.9) 0 0 24px, rgb(0,229,255) 0 0 60px, rgba(0,229,255,0.7) 0 0 120px` / `text-transform: uppercase` / `letter-spacing: 14.4px` |
| `04-verdict-badge.png` | 判定バッジ | 字幕が消えない（`買い！`）/ `-webkit-text-stroke-width: 8px` / `text-shadow: rgba(229,57,53,0.6) 0 0 16px` |
| `05-style-preset-gap.png` | 申し送り記録 | `style_preset` だけの cue は無装飾（`font-size: 38px` / 4 方向の既定影） |

4 面すべてで **4 方向 `text-shadow` の擬似輪郭は出ない**（契約 `docs/contract-2026-08-02-preview-parity.md` §2.2.1）。
全計測値は `l1-metrics.json`。

## 申し送り（本票のファイル境界外）

`apps/shell/extensions/akari-preview/src/node/akari-preview-service.ts` の
`resolveCaptionDisplay` は `applyCaptionStylePresets` を通していないため、
**`display_policy` 付きプロジェクトでは `captions[].style_preset` が無視される**
（legacy 経路 `parsePreviewCaptions` は通している）。`05-style-preset-gap.png` がその状態。
同ファイルは本票の所有外なので直していない。別票で 1 行入れれば解消する。
