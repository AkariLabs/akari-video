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

### 複数参照と両側の下書き（step 10–13）

既存 step 1–9 を維持し、先の偽 CLI の failed meta を隔離 fixture 内で取り除いて
H3 の動画予定から検証する。切替・＋追加・素材カード2枚・完了をすべて CDP の実クリックで操作する。

- `13-reference-empty.png`: 「参照」への切替で枠が消え、グリッドと「＋ 追加」が出る。
- `14-reference-picking-two.png`: 素材パネルで画像2枚を選択した状態。
- `15-reference-two.png`: `@画像1` / `@画像2` と「画像 2 / 9」。
- `16-reference-frames-restored.png`: 「最初 / 最後」へ戻り、元のサムネが残る。
- `17-reference-restored.png`: 再び「参照」へ戻り、2枚と札が残る。

追加 step の `results.json` に、各切替後の `next`、カードの札・×・サムネの矩形と
全3組の交差判定、切替・＋追加・×の計算後背景色・枠幅・枠種・枠色・disabled を記録する。
非交差、面積が正、押せるボタンに背景か可視の枠線があることを assert する。
モデル ID と `frames_or_refs`、両側の `next.inputs`、選択順、元の枠のサムネ、
edit/captions の mtime も検証する。L1 はラッパーで実行し、既存 PNG / results.json は実行まで更新しない。

素材選択は受け側の単一 slot 契約に合わせた種類別の複数選択。
「追加する参照の種類」で画像・動画・音声を選び、「＋ 追加」で開く。
`selected` はその種類の現在の全パス、`max` は validator の総上限（既存選択込み）。
参照を送る側に非対応の種類があれば validator が error とし「動画にする」を無効にする。
`send_side=frames` では参照全体が送信から除外されるが、下書きは消さない。
実カタログには Veo 3.1 にも flf/ref の同 family があるため、ID の接尾辞によらず切替を表示する。
Veo reference のアダプタ未実装、および Kling の参照アダプタ拒否は既存送信層の制限のまま。

種類をまたぐ追加順は workspace URI と item ID ごとのローカル UI 状態として保持し、
meta の監視による再読込とアプリ再起動で復元する。生成 inputs / provider body に UI 用の欄は加えない。
