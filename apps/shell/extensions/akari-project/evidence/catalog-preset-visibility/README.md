# catalog-preset-visibility evidence

Production build 済みの Electron 製品を wrapper から起動し、`webContents.debugger`（CDP）で
実 DOM を操作・検査した証跡。素材カタログとは別の読み取り専用棚であることを、件数・button 数・
素材カード数・パック棚数から機械判定する。

実行環境が Electron GUI を起動できない場合は、同じ production build の `lib/backend/main.js` を
起動し、`run-cdp.mjs` で headless Chrome の CDP から同一 DOM 検査を行う。

## 再現

```sh
EVIDENCE_ROOT="$(mktemp -d)"
EVIDENCE_DIR="$PWD/apps/shell/extensions/akari-project/evidence/catalog-preset-visibility"
mkdir -p "$EVIDENCE_ROOT/workspace" "$EVIDENCE_ROOT/profile"
cp -R "$PWD/templates/project-default/." "$EVIDENCE_ROOT/workspace/"
node "$EVIDENCE_DIR/run-l1.mjs" \
  "$PWD/apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$PWD/apps/shell" \
  "$EVIDENCE_ROOT/workspace" \
  "$EVIDENCE_ROOT/profile" \
  "$EVIDENCE_DIR"
```

CDP fallback は別ターミナルで production backend を起動してから実行する。

```sh
cd apps/shell
node lib/backend/main.js /path/to/workspace --hostname=127.0.0.1 --port=31234
node extensions/akari-project/evidence/catalog-preset-visibility/run-cdp.mjs \
  http://127.0.0.1:31234 \
  /path/to/chrome-headless-shell \
  "$PWD/extensions/akari-project/evidence/catalog-preset-visibility"
```

## 証跡

- `01-telop-36-read-only.png`: テロップ 36 件のカード表示。各項目内 button は 0。
- `02-lut-list.png`: LUT 10 件のリスト表示。説明付き、各項目内 button は 0。
- `03-preset-search-filter.png`: LUT の id 検索で「ナイトネオン」1 件へ絞り込み。
- `run-log.json`: 上記に加え、素材のみの「すべて 62」、カード/リスト切替、専用 0 件文言を実測。
