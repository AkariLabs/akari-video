# トラックの詰め方 L1

`gen-fixture.mjs` は本編、テロップ、B ロール、効果音、BGM、字幕を含む v2 プロジェクトを一時領域に生成します。`l1.mjs` は起動済み Electron の CDP 9466 番へ接続し、操作結果を JSON とスクリーンショットで一時領域に保存します。

リポジトリのルートから実行します。

```sh
node apps/shell/extensions/akari-annotations/evidence/tl-track-tags/gen-fixture.mjs
(cd apps/shell && npm run build)
```

Electron は隔離した `AKARI_HOME`、`THEIA_CONFIG_DIR`、`--user-data-dir` と 9466 番で起動します。macOS では次のように起動できます（ラッパーが起動する場合も同じ隔離値を渡します）。

```sh
repo_root=$(pwd)
isolation=/tmp/akari-tl-track-tags-l1
mkdir -p "$isolation/akari-tl-track-tags-home" "$isolation/akari-tl-track-tags-config" "$isolation/akari-tl-track-tags-user"
AKARI_HOME="$isolation/akari-tl-track-tags-home" \
THEIA_CONFIG_DIR="$isolation/akari-tl-track-tags-config" \
env -u ELECTRON_RUN_AS_NODE "$repo_root/apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$repo_root/apps/shell" /tmp/akari-tl-track-tags-fixture \
  --remote-debugging-port=9466 --user-data-dir="$isolation/akari-tl-track-tags-user" --no-sandbox
```

起動後、別のシェルで実行します。

```sh
node apps/shell/extensions/akari-annotations/evidence/tl-track-tags/l1.mjs
```

生成先は `AKARI_TL_TRACK_TAGS_PROJECT`、結果先は `AKARI_TL_TRACK_TAGS_RESULTS` で変更できます。実測結果は `results.json` に入り、各項目の `pass` と測定値を確認できます。

`AKARI_TL_TRACK_TAGS_BEFORE` に起動前の edit.json の複製を渡すと、「開いただけでは書かない」を起動前のバイト列と比べます。

`l1-extra.mjs` は、起動し直した fixture に対して「本編だけ切る」「選んだトラックだけ切る」、見出しの右クリック、2 スイッチ表示の低い行・高い行、設定画面を測り、`results-extra.json` に保存します。

`results/` は 2026-10-06 の実測（両スクリプトとも全項目 pass）の結果 JSON とスクリーンショットです。JSON 内のパスは `<project>` / `<results>` に置き換えています。
