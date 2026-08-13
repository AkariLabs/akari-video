# catalog-pane-compact-ux evidence

このディレクトリの証跡は、production build 済みの実 Electron 製品バンドルを
`electron-wrapper/main.cjs` から起動し、`webContents.debugger`（CDP）で操作・計測して取得する。
手書き HTML やモック DOM を使う経路はない。

## 再現手順

リポジトリ root で、Electron 実体を `apps/shell/node_modules/electron/dist` へ展開し、
`apps/shell` の `npm run build` が成功している状態から実行する。

```sh
AKARI_L1_ROOT="$(mktemp -d)"
AKARI_L1_APP="$PWD/apps/shell"
AKARI_L1_EVIDENCE="$PWD/apps/shell/extensions/akari-project/evidence/catalog-pane-compact-ux"
AKARI_L1_WORKSPACE="$AKARI_L1_ROOT/workspace"
AKARI_L1_PROFILE="$AKARI_L1_ROOT/profile"
mkdir -p "$AKARI_L1_WORKSPACE" "$AKARI_L1_PROFILE"
cp -R "$PWD/templates/project-default/." "$AKARI_L1_WORKSPACE/"
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_PROFILE" \
  "$AKARI_L1_EVIDENCE"
```

`electron-l1-hook.cjs` は Theia の preload overlay が DOM から消えるのを待ち、素材パネルを
開いて split handle をドラッグし、パネル幅を 320px 相当へ変更してから検査する。
合成クリック前には `document.elementFromPoint` で対象が最前面にあることも確認する。

## 出力と観測項目

| file | observation |
|---|---|
| `01-compact-controls-and-chips.png` | compact control row + category row only; fixed six categories include zero counts |
| `02-grid-three-columns.png` | three or more card columns at approximately 320px panel width |
| `03-zero-category.png` | `overlay (0)` selected; category-specific empty message |
| `04-list-view.png` | horizontal list rows; action at right; pack shelf preserved |
| `05-resolver-retry-row.png` | resolver-failure retry row inside the scroll body |
| `06-list-persisted-after-reload.png` | restored list layout state after a real page reload |
| `run-log.json` | measured DOM values and assertion results from the same Electron run |

アカウント・接続 UI の削除確認は、ホーム面に正当に存在する同名フックを誤検出しないよう、
`data-akari-top-view="catalog"` のサブツリーだけを検査する。

## この環境での audio 試聴の制約

この L1 は resolver を失敗させ、ローカル `catalog/` のみで再現する。ローカル項目には
`mediaUrl` がないため `data-akari-catalog-audio-toggle` は描画されず、実際に音を鳴らして
「表示切替では止まらない / 戻ると止まる」を再現できない。L1 は代わりに、表示切替ボタンの
click が React root container の外へ伝播しないことを検査する。また、audio トグルが存在する環境では
全トグルが `data-akari-catalog-list-row` 内にあることを条件付きで検査する。実装コードパスは
`renderCatalogListRow` にあるが、実試聴はこの証跡環境の未確認事項として残す。

伝播停止は、表示切替ボタンから React root container を特定し、その親で native click を
観測して、React 合成イベントの `stopPropagation` が外へ届くのを止めることを検査する。
面内要素の listener は React ハンドラより native バブリングが先に通るため検査には使えない。
