# transcribe-simple-mode — L1 証跡（簡単モード / アドバンス）

文字起こしのポップアップを「簡単（既定）」と「アドバンス」に分けた変更の実機観測。
Electron を隔離プロファイル（`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` /
`AKARI_HOME` / `AKARI_CREDENTIALS_FILE` すべて一時ディレクトリ）で起動し、CDP で DOM を
機械照合しながら操作した記録。実利用の `~/.theia` `~/.akari` `~/.config/akari-video` は
読み書きしない。

## 走らせ方

```sh
# 1. fixture（実素材の先頭 30 秒を切り出した未文字起こしプロジェクト）を作る
AKARI_L1_SOURCE=<音声つき動画の絶対パス> node scripts/gen-fixture.mjs

# 2. シェルを本番モードでビルドしてから L1 を回す
(cd ../../../.. && npm run build)
WHISPER_CPP_MODEL=<ggml-*.bin の絶対パス> node scripts/run-l1.mjs
```

`fixture/` と一時プロファイルは検証専用なのでコミットしない（`run-l1.mjs` は毎回
`fixture/simple-mode/.akari` と `captions.json` を初期化してから測る）。
`WHISPER_CPP_MODEL` を省くと `whisper-model-candidates.mjs` の既定の探索順に従う。

## 観測結果（`results.json`）

9 ステップすべて pass / console error 0 件。

| SS | 観測 |
|---|---|
| `01-simple-default-popup.png` | 既定 = 簡単。ステップバー 0・比較チェック 0・radar 0、カード 4 枚。button は「起こす」と切替リンクの 2 つだけで、可用性は 4 枚とも非対話の札（`span` + `role=status`）。エンジン選択のラジオ 5 個（おまかせ + 4 エンジン） |
| `02-simple-progress.png` | whisper のカードを選んで「起こす」→ 同じ 1 画面のまま `起こしています… 0:00 / 0:30`（`data-step` は `1` のまま・nav 0） |
| `03-daihon-rows-after-simple.png` | 完了で人の操作 0 回のままダイアログが閉じ、台本に 10 行・`captions.json` 10 件（whisper・dogfood 素材の先頭 30 秒） |
| `04-simple-already-transcribed.png` | 済みの素材でも簡単モードは「台本へ」「起こし直す」の 2 ボタン |
| `05-advanced-after-switch.png` | 切替リンクでアドバンスへ（ダイアログは閉じない）。ステップバー 6 ボタン・比較チェック 4・radar 4・3 出口（このまま字幕へ / 起こし直す / 比べる）が従来どおり。可用性の札は設定へ飛ぶ button に戻る |
| `06-settings-simple.png` | 設定「文字起こし」節の先頭に 簡単 / アドバンス の 2 択。簡単では比較・カットの行が畳まれ「比較・カット候補の自動作成: アドバンスで使います」の 1 行だけ残る |
| `07-settings-advanced.png` | アドバンスを選ぶと比較の組（チェック 1 + エンジン 4）とカット候補の行（1）が戻る |
