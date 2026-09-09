# timeline-filmstrip-size-gate — L1 証跡

タイムライン帯のフィルムストリップ（サムネ）が「クリップ幅 40px 未満」「トラック高 48px 未満」で
丸ごと消える件の修正。BEFORE = 基点 `3f74b798`（v0.1.60）の widget、AFTER = 本修正。
BEFORE / AFTER とも同じドライバ・同じ素材・同じ操作で 1 本ずつ逐次実行した（Electron は同時 1 本）。

## 検証環境

- 隔離ワークスペース（一時ディレクトリ・`AKARI_HOME` も一時ディレクトリ）に `edit.json` v2 を生成
- 素材: `ffmpeg -f lavfi -i testsrc2=s=320x180:r=30 -t 60`（60 秒）
- タイムライン: 同素材の 10 秒カット × 30 本 = 300 秒（5 分プロジェクト）
- 起動: `Electron <apps/shell> <workspace> --remote-debugging-port=… --user-data-dir=… --no-sandbox`、
  CDP に playwright-core で接続。終了時に PID 指名で kill（残留 0 件を確認）

## 結果

| シナリオ | 条件 | BEFORE | AFTER |
|---|---|---|---|
| S0 通常倍率 | 帯幅 141.33px / トラック高 48px | サムネ有り 9/9 クリップ・36 セル | サムネ有り 9/9 クリップ・36 セル |
| (a) トラック高 47px | ヘッダーを実ドラッグで 48 → 47 | **0/9 クリップ・0 セル** | サムネ有り 9/9・36 セル |
| (b) ズームアウト | 帯幅 19.99px（30 クリップ） | **0/30 クリップ・0 セル** | サムネ有り 30/30・30 セル |
| (c) トリムで 40px 境界越え | 帯幅 55.06px → 34.13px（`duration` 300 → 186 フレーム） | 越えた瞬間 **0 セル**（可視 24 クリップすべて 0） | 1 セル（可視 24 クリップすべてサムネ有り） |

- S0（通常倍率）の見た目は不変: `s0-normal-before.png` と `s0-normal-after.png` の画素差は
  **1,847,016 画素中 56 画素（0.003%・最大チャンネル差 16）**
- (c) は実際のポインタドラッグでトリムしている（`dragState = {kind:'cut-trim', edge:'right'}` を観測、
  `edit.json` の `duration` が 300 → 186 に書き換わったことを確認）

## ファイル

| ファイル | 内容 |
|---|---|
| `s0-normal-{before,after}.png` | 通常倍率（回帰確認用の 1 枚比較） |
| `sa-track47-{before,after}.png` | (a) トラック高 47px |
| `sb-zoomout-{before,after}.png` | (b) 帯幅 20px までズームアウト |
| `sc-trim-pre-{before,after}.png` | (c) トリム前（帯幅 55px） |
| `sc-trim-{before,after}.png` | (c) トリム後（帯幅 34px） |
| `measurements-{before,after}.json` | 各シナリオの実測値（帯幅・トラック高・セル数・`edit.json` の duration） |

作業機の絶対パス・HOME・一時ディレクトリは `<WORKTREE>` / `<HOME>` / `<TMP>` に置換済み。
起動ログ（`electron-*.log`）はリポジトリの `.gitignore`（`*.log`）により追跡しない。
