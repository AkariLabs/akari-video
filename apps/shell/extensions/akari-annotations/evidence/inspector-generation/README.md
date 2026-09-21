# インスペクター生成パネル L1

既存の PNG / results.json は再実行まで旧 UI の記録。更新スクリプトは次の 10 枚を撮影する。

- `01-h3-first-to-last.png`: H3 の最初・最後に別々のサムネ、種類「最初→最後」
- `02-prompt-only.png`: 両枠が空、種類「プロンプトだけ」、外すボタンなし
- `03-cost-approval-dialog.png`: 金額・as_of・モデルを含む費用承認 1 回
- `04-failed-retry.png`: 失敗後の「同じ入力でもう一度」
- `07-sticky-tab-strip.png`: 生成タブの下端までスクロールしてもタブ帯が上端に見える状態（r1）

先に shell のビルドを用意し、リポジトリルートで実行する（依存の install は不要）。

```sh
node apps/shell/extensions/akari-annotations/evidence/inspector-generation/scripts/l1-inspector-generation.mjs
```

`FFMPEG=/path/to/ffmpeg`、`--port=22213` で実行環境を指定できる。
AKARI_HOME / THEIA_CONFIG_DIR / --user-data-dir は os.tmpdir() の専用一時ディレクトリ。
Electron は apps/shell/node_modules を優先し、無ければリポジトリ root の node_modules を使う。
終了時に自分が起動した Electron の PID・一時設定・fixture/ を片付ける。
素材は `fixture/project/` に毎回作り直す。実ユーザー設定・ライブラリを使わない。

同ディレクトリの `scripts/fake-generate.mjs` はネットワークを使わず、素材 meta の `next` と
起動引数を `fixture/project/fake-invocation.json` に記録して failed の生成物 meta を書く。
`--inputs` があれば失敗する。L1 はその引数と next の内容を `results.json` に記録する。

送信前と再試行の撮影直前にボタンを中央へスクロールし、矩形がインスペクターの可視範囲に
完全に収まることを assert する。results.json の step 3 / 5 にボタン矩形・可視範囲・判定を残す。
fixture/ を削除した後も、偽 CLI の引数と next は step 4 の記録に残る。

### r1 の見た目と計測

`01-h3-first-to-last.png` と `04-failed-retry.png` は同名で上書きし、主・副・小ボタンと
カメラの選択状態、コンパクトな枠、見積 → 再試行 → 送信の並びを撮り直す。
追加の `07-sticky-tab-strip.png` は既存の `05-timeline-chip-generating.png` と別名にする。

既存 6 step に加え、`results.json` の `r1.controls` に主ボタンの `backgroundColor`、
「隣から取る」の `borderTopWidth`、カメラ各ボタンの `aria-pressed` を記録し、
地が透明でない・枠幅が正・選択中の 1 つだけが `true` であることを assert する。
`r1.stickyTabStrip` と追加 SS の `screenshotDetails` にスクロール量、タブ帯と
スクロールコンテナの上端座標・差を記録する。`scrollTop > 0` と上端の差 `≤ 1px`、
タブ帯の可視状態を撮影直前に assert する。

### 枠からの素材選択（step 7–9）

既存の step 1–6 の後に、枠と素材カードへの CDP `Input.dispatchMouseEvent` による実クリックを追加。
fixture の赤・青・緑の画像（`assets/stills/a.png`〜`c.png`）を素材パネルから選ぶ。
有償 API は使わない。追加撮影は次の 5 枚。

- `08-frame-empty.png`: 空の「最初の絵」と選択文言
- `09-frame-picking.png`: 「最初の絵 に入れる素材を選ぶ」の帯と紫の二重の輪
- `10-frame-picked.png`: 緑の絵を入れたサムネと種類「画像から」
- `11-frame-replaced.png`: 「最後の絵」を青から赤へ差し替えた後
- `12-frame-cancelled.png`: Esc 後、絵を保ったまま輪と帯が消えた状態

`results.json` の追加 step に、枠の role / tabindex / cursor / aria-disabled / aria-pressed、
計算後の border / background / box-shadow / outline、枠と近道ボタンの矩形を記録する。
ボタンとしての背景または枠線、紫の二重の輪、矩形が交差しないことを assert する。
選択後の `a.png.meta.json` の `next.inputs.first_frame.path`、最後の絵の変更前後のサムネ src、
Esc 前後の meta のバイト列とサムネの不変性、edit/captions の mtime 不変も assert する。

受け側には取り消しコマンドがない。再押下・クリップ変更・生成タブ以外への移動・dispose 時は
送信側が結果を捨てて輪を外し、素材パネルの帯は Esc または「やめる」で閉じる。
L1 の実行と証跡更新は Electron を起動できるラッパー側で行う。
