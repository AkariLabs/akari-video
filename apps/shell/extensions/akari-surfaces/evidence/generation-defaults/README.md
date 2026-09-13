# 生成の既定モデル（設定 → 接続と API キー）の L1 証跡

設定ダイアログの fal 行に出る「既定モデル」ブロックを、本番ビルドの Electron 上で
`webContents.debugger`（CDP）から観測する再現ハーネス。

観測点:

1. `[data-akari-generation-defaults]` が **fal の行の中**に出る。静止画の選択肢 2 行 /
   動画の選択肢 12 行（カタログ `packages/schemas/gen-models.json` と同数）
2. 初期値は同梱既定（静止画 `codex:image` / 動画 `fal:h3-i2v`）で、出所は両方「既定」。
   選択中の文言に事実帯（価格・音声・`as_of`）が出る
3. 動画の既定を Kling（`fal:kling-v3-pro-i2v`）へ変えると
   - 画面の出所が「ワークスペース」に変わる（静止画は「既定」のまま）
   - `<作業場>/.akari/connections.json` の `defaults.generate.video` **だけ**が変わり、
     `providers` / `policy` / `memory` は 1 バイトも変わらない
   - 書き込まれたファイルが `packages/schemas/bin/validate-connections.mjs` を exit 0 で通る
   - `credentials.env` の mtime が変わらない

`HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` / `AKARI_CREATOR_ROOT` /
`AKARI_CREDENTIALS_FILE` はすべて使い捨ての一時プロファイルへ向けるので、実利用の
`~/.theia` `~/.akari` `~/.config/akari-video` `~/Akari` は触らない。Electron は detached に
せず、終了時に PID 指名で kill して孤児 0 件を確認する。

## 再現

リポジトリ直下で、本番シェルビルドのあと:

```sh
cd apps/shell && npm run build
cd ../.. && node apps/shell/extensions/akari-surfaces/evidence/generation-defaults/run-l1.mjs
```

| ファイル | 中身 |
|---|---|
| `01-settings-generation-defaults.png` | 変更前（両方「既定」） |
| `02-video-default-kling.png` | 動画を Kling に変えた後（出所「ワークスペース」） |
| `l1-report.json` | 判定 9 件と書き込まれた connections.json |
| `run-log.json` | CDP から読んだ DOM の観測値 |
| `l1-log.txt` | Electron の起動ログ（作業機のパスは置換済み） |
