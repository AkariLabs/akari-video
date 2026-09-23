# ライブラリの試聴プレビューを下端のドックへ — L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は
  このタスク専用の一時ディレクトリ。CDP ポート 9455。カタログは本番（resolver 経由 360 件）
- fixture: `templates/project-default` の複製 + 6 秒の `assets/base.mp4` + 4 秒の `assets/audio/tone.wav`。
  edit.json は V1（base 0〜6 秒）/ A1（空）。入れ替えの確認だけ A1 に `bgm-1`（tone.wav）を置いた版を使った
- 左パネルは既定幅（165px）だと BGM カードが 3 列に潰れるため、スプリッターを動かして 328px にしてから採った（`scripts/mdrag.mjs`）。
  `before-bgm-toggle.json` / `before-bgm-reclick.json` だけは既定幅のまま採った記録（ずれ量は同じ 39.5px）
- 再生トグル・ドックのボタン・＋・カード本体は実マウスクリック。共有の試聴 `<audio>`（DOM 外の `new Audio()`）は
  `HTMLMediaElement.prototype.play` をフックして参照を取り、`paused` / `currentTime` を読んだ（`scripts/audiohook.mjs`）
- 「一覧のずれ」= 先頭 6 枚のカードの `getBoundingClientRect().top` の差。スクロール位置 = 一覧のスクロールコンテナの `scrollTop`
- 画面座標は CSS px（ウィンドウ 1120×668）。スクリーンショットは 1120px 幅へ縮小

## BEFORE（変更前ビルド = 基点コミット）

| 観測 | 記録 | 結果 |
|---|---|---|
| BGM カードの再生トグル | `before-bgm-toggle.json` / `before-bgm-toggle-wide.json` / `before-bgm-playing-wide.png` | 一覧の真上に `DIV[data-akari-catalog-audio-bar]`（position: static・高さ 32px）が挿入され、**カードの top が 39.5px 下へずれる**（184.2 → 223.7） |
| 同じカードの再クリック | `before-bgm-reclick.json` | バーが消えて −39.5px 戻る |
| 一覧を scrollTop 900 までスクロールしてから再生 | `before-bgm-scrolled.json` / `before-bgm-scrolled.png` | バーはスクロール領域の先頭（画面外、top −765）に入り、scroll anchoring で scrollTop が 900 → 940。**停止手段が画面に出ない** |
| SFX カードの再生トグル | `before-sfx-toggle.json` / `before-sfx-playing.png` | BGM と同じ `[data-akari-catalog-audio-bar]` が挿入され 39.5px ずれる |
| プロジェクト面の素材カード（音声・動画）の hover とクリック | `before-project-audio-card.json` / `before-project-video-card.json` | カードの top は不変（88 のまま）。一覧の上に挿入される要素なし → 本件はライブラリ面のみ |

## AFTER（本ブランチ）

| 観測 | 記録 | 結果 |
|---|---|---|
| BGM カードの再生トグル | `after-bgm-toggle.json` / `after-bgm-playing.png` | **カードの top のずれ 0px**（184.2 のまま）、scrollTop 差 0。挿入は `DIV[data-akari-catalog-audio-dock][data-akari-catalog-audio-bar]` 1 つで、一覧のスクロールコンテナの外（`dockInsideScroller: false`）・`position: absolute`・top 554 / bottom 590（パネル下端）。文言「再生中: After the Rain / 停止 / ×」。音は再生中（paused false） |
| 出るときの動き | `after-bgm-toggle.json`・`after-reduced-motion.json` | `animation: akari-catalog-audio-dock-enter 0.18s`（下から 16px + フェード）。40ms 時点で translateY 0.83px・opacity 0.95。`prefers-reduced-motion: reduce` をエミュレートすると `animation-name: none`・opacity 1・transform none（即時） |
| 同じカードの再クリック | `after-bgm-reclick.json` | ドックが消え、音が止まる（paused true）。ずれ 0px |
| ドックの「停止」 | `after-dock-stop.json` | ドックが消え、音が止まる |
| ドックの × | `after-dock-close.json` | ドックが消え、音が止まる |
| scrollTop 900 から再生 | `after-bgm-scrolled.json` / `after-bgm-scrolled.png` | scrollTop 900 → 900、ずれ 0px、ドックは画面内の下端（top 554） |
| 再生中に別カードを再生 | `after-bgm-switch.json` | 共有プレイヤーが切り替わり（Clockroom → Clap Drop）、ドックの曲名も更新。ずれ 0px |
| SFX カードの再生トグル | `after-sfx-toggle.json` / `after-sfx-playing.png` | ずれ 0px、同じドックが下端に出る |
| 別の面への切替（ライブラリ → プロジェクト） | `after-surface-switch.json` | ドックが消え、音が止まる |
| 再生中にライブラリのホーム → パックへ移動 | `after-pack-view.json` | 面内のクリックで止まる既存の挙動どおり停止し、ドックなし（パック画面の音源カードには再生トグルが無い） |
| 再生中に ＋（タイムラインに追加） | `after-plus-while-playing.json` | edit.json に `audio-1`（`bgm-jazzhop-piano-086.mp3`）が追加された。ドックと音はそのまま、カードの top 不変 |
| 再生中にカード本体をクリック | `after-body-click-while-playing.json` | edit.json 不変（選ぶだけで追加しない）。面内クリックで試聴が止まる既存の挙動どおりドックが消える |
| 候補棚（入れ替え）を開く | `after-swap-shelf.json` / `after-swap-shelf.png` | 再生中に `bgm-1` を選んで棚を開くと試聴が止まりドックは消える。棚の中の音源カードの再生トグルを押しても**ドックは出ない**（候補棚ではプレビューを出さない裁定）。再クリックで止まる |

## スクリプト

`scripts/` — `measure.mjs`（再生トグル / カード本体のクリックと一覧のずれ・ドックの位置）/ `dockbtn.mjs`（ドック内ボタン）/
`reduced.mjs`（`prefers-reduced-motion` のエミュレート）/ `plus.mjs`（＋・カード本体、`WS` に fixture のパス）/ `swapcheck.mjs`（候補棚）/
`projcard.mjs`（プロジェクト面のカード）/ `opencat.mjs` / `audiohook.mjs` / `cmd.mjs` / `ev.mjs` / `shot.mjs` / `click.mjs` / `mdrag.mjs`。
CDP ヘルパーは `../materials-tab-hardening/cdp-lib.mjs`。ポートは `CDP_PORT`（既定 9455）。
