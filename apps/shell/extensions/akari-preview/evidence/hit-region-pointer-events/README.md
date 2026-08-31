# hit-region-pointer-events — 視覚 `clip-path` 退役の検証証跡

オーバーレイの当たり判定を既存の `pointer-events` 規約へ一本化し、当たり判定用
`clip-path` が描画まで切る副作用を構造的に除去した。issue #36 の全画面背景、透明な全画面
ラッパー、`overflow: visible` のはみ出し描画を対象に、headless Chrome、Web UI、実 Electron、
OSR 書き出しで検証した。

## 依存調査

overlays の選択入口は `interaction.js` の `onClick` → `overlayForEvent` →
`findOverlayContainer(event.target)` だけである。ブラウザのネイティブヒットテストが返す
`event.target` が唯一の入口で、`elementsFromPoint` で clip 領域を補正する経路も、`hitRegion` を
読む別経路もない。

旧 `clip-path` は「コンテナ配下のヒットを bbox 内へさらに絞る」二重の絞り込みでしかなく、
描画も同時に切る副作用を持っていた。コード読みと実クリックテストの双方で、
`pointer-events` だけでは選択・素通しが成立しない反例は見つからなかった。

Web UI で issue #36 計測時に `clip-path: none` のままだった理由は、
`syncOverlayHitRegion` の呼び出しが編集モード ON の間だけだったためである。呼び出し箇所は
`app.js` の `setEditMode` 内にある初期同期ループと、`tick` 内の `editMode` ガード付きの 1 行に
限られる。issue #36 の計測は編集モード OFF だった。

## 差分

- `computeHitClipPath()` と `fragmentRootPaintsOutside()` を撤去した。
- `syncOverlayHitRegion()` は公開 API 互換を保った no-op とし、視覚 `clip-path` を一切書かない
  （`-63` 行 / `+5` 行）。
- `applyOverlayHitPolicy()` は 1 バイトも変更していない。
  `fragmentRootCoversContainer` による「コンテナを 98% 以上覆う断片ルートは素通し」の既存規則を
  そのまま温存しており、ヒット挙動は不変である。
- 変わるのは、旧 `clip-path` が描画を切っていた分だけである。
- Web UI 用 `overlay-interaction.bundle.js` は preview-server の build script と同じ引数で再生成した。

## shell L1（実 Electron + CDP）

issue #36 fixture の 2.0 秒を、ビューポート 1600×1200、無選択の既定状態で測定した。
一次証跡は [before-shell.json](./before-shell.json) / [after-shell.json](./after-shell.json)、実 Electron
ウィンドウ全体のキャプチャは [before-shell-window.png](./before-shell-window.png) /
[after-shell-window.png](./after-shell-window.png) である。

| 項目 | BEFORE（HEAD） | AFTER（本ブランチ） |
|---|---|---|
| コンテナ inline `clip-path` | `none` | 未設定（空文字） |
| コンテナ computed `clip-path` | `none` | `none` |
| 断片ルート `pointer-events` | `none` | `none` |
| `.s-issue-36__title` `pointer-events` | `auto` | `auto` |
| 断片ルート矩形（webview px） | left 36 / top 300.59375 / 821×461.8125 | 同一 |
| (b) 素通し: 文字のない背景（ルート幅 80% / 高さ 85%）をクリック | hit stack = `DIV#preview-stage` → `DIV#zoom-layer` → `DIV#preview-wrapper` → `SECTION.preview-pane` → `MAIN.workspace`、選択 `null`、可視選択枠 0 | 同一 |
| (c) 選択: `.s-issue-36__title` 中心をクリック | hit stack 先頭 = `DIV.s-issue-36__title`、`data-akari-interaction-selected="true"`、可視選択枠 1 | 同一 |
| 選択枠 | left 104.4140625 / top 488.734375 / 534.28125×85.515625、border `1px solid rgba(255, 157, 66, 0.98)` | 同一 |
| (c) 解除: Esc | 選択 `null`、可視選択枠 0 | 同一 |
| 断片ルート 2px 内側 8 点 vs 同軸 8px 内側 | 最大差 1/255（top-mid / tl / tr / bl が 1、他 4 点が 0） | 同一。8 点の RGB も完全一致 |
| `#preview-stage` の 2px 外側 4 点 | `rgb(44,45,48)`（pasteboard） | 同一 |

`before-shell.json` と `after-shell.json` は `clipPathInline` の 1 項目を除いて JSON 全体が完全一致した。
矩形、hit stack、選択枠、全画素値まで一致している。

### 再実行

探針は [scripts/run-shell-l1.sh](./scripts/run-shell-l1.sh) と
[scripts/run-shell-l1.mjs](./scripts/run-shell-l1.mjs) で、CDP client は
[scripts/cdp-lib.mjs](./scripts/cdp-lib.mjs) に同梱した。

```sh
AKARI_REPO=<repository> \
AKARI_FIXTURE=<issue-36-fixture> \
apps/shell/extensions/akari-preview/evidence/hit-region-pointer-events/scripts/run-shell-l1.sh after
```

## OSR 書き出し

issue #36 fixture の複製を次の条件で書き出し、BEFORE / AFTER の PNG SHA-256 が一致した。
`engine.resolved` は `osr`。この機材の offscreen GPU が空ビットマップを返すため、両測定とも
`AKARI_OSR_SOFT=1` を共通条件としている。

```sh
AKARI_OSR_SOFT=1 akari capture --engine osr -t 2.0 --separate --full
```

| 出力 | 解像度 | BEFORE / AFTER SHA-256 | 判定 |
|---|---:|---|---|
| `2s-full.png` | 1920×1080 | `50ad7b20003c96773e14ed60c3334f50588028d914d111a0d02e770a71413077` | 一致 |
| `2s.png` | 1280×720 | `ebef8a1058436dd6627e3bbf5061d71ff68a78e942f957e15680c9bf946e1857` | 一致 |

比較結果は [capture-osr/sha256.json](./capture-osr/sha256.json)、AFTER のフル解像度参照は
[capture-osr/after-osr-2s-full.png](./capture-osr/after-osr-2s-full.png) に保存した。

## Web UI 24 点

編集モード OFF、2.0 秒、実 Chromium 1200×900 で、断片ルートの 8 アンカー × 3 オフセット
= 24 点の RGB を比較した。

- 同一サーバプロセスで `overlay-interaction.bundle.js` だけを差し替えた対照実験では、24 点が
  すべて完全一致し、最大差は 0 だった。
- worktree のサーバを新規起動した AFTER 測定も、24 点完全一致、最大差 0 だった。
- コンテナの `clip-path` は BEFORE / AFTER とも `none`。編集モード OFF では
  `syncOverlayHitRegion` が元から呼ばれないためである。
- 長時間起動したままのサーバによる 1 回の測定だけ 3 点で 1/255 の差が出た。同じサーバで
  バンドルだけを差し替えた対照が差 0 なので、コード差ではなくサーバプロセスの寿命に起因する
  測定ゆらぎと判定した。

一次証跡:

- [before-webui-measure.json](./before-webui-measure.json)
- [after-webui-measure.json](./after-webui-measure.json)
- [after-webui-measure-freshserver.json](./after-webui-measure-freshserver.json)
- [webui-24points-summary.json](./webui-24points-summary.json)

## L0

| スイート | BEFORE | AFTER |
|---|---|---|
| `packages/overlay-runtime` test-harness | 39 / pass 39 / fail 0 | **43** / pass 43 / fail 0（新規 4 件） |
| `apps/shell/extensions/akari-preview` | 454 / pass 450 / fail 4 | 454 / pass 450 / fail 4（失敗 4 件の名前まで一致） |
| `apps/shell` `build:ext` / `lint` | — | exit 0 / exit 0 |
| `packages/preview-server` | 下記 | 下記 |

preview-server は実ブラウザを起動する重いテストが機材負荷（load average 40〜400）でタイムアウトし、
失敗集合が走行ごとに揺れた。AFTER で落ちた次の 5 件は、すべて BEFORE でも同一条件で落ちることを
個別に確認した。

- `projection PUT は v2 木を保持し…`（`preview-server did not start`）:
  負荷が下がった AFTER 単独走行では PASS、BEFORE の一括走行では FAIL。
- `実 Web UI は transition_out だけを保存し…`:
  BEFORE / AFTER とも単独走行で 45 秒タイムアウト（load ≈ 50）。
- `audio.master is disclosed in the indicators popup`
- `実 preview: seeked までミュートを維持して…`
- `test/preview.test.mjs`（ファイル単位）

末尾 3 件も BEFORE の一括走行で同じく FAIL しており、本変更による失敗集合の増加ではない。

## 新規・更新テスト

`packages/overlay-runtime/test-harness/pointer-events-hit-region.test.mjs` に、実ブラウザのネイティブ
ヒットテストと実描画ピクセルを通る 4 件を追加した。

1. (a) 断片が描いている場所の実クリックでその断片を選択する。
2. (b) 全画面透明ラッパーの空白を実クリックすると下のオーバーレイへ素通しする。
3. (c) 全画面を描くルート断片を選択でき、背景の実ピクセルが無傷。
4. (d) `overflow: visible` でルート外へはみ出す描画の実ピクセルが欠けない。旧
   `clip-path` 実装では欠けたケースである。

既存の `entry-animation-hit-region.test.mjs` と `run-tests.js` は、手段である
「`clip-path` が bbox を内包する」の検査から、目的である「`pointer-events` 規約だけで当たり判定が
成立する」の検査へ変更した。前者は `page.mouse.click` による実クリック、後者は
`elementsFromPoint` によるネイティブ hit stack を確認する。

## 結論

選択、透明ラッパーの素通し、選択枠の表示・解除、実画素、Web UI、OSR 書き出しの全観測で、
BEFORE / AFTER の差はコンテナの inline `clip-path` が `none` から未設定になった 1 項目だけだった。
既存の `pointer-events` ヒット規約を変えず、描画を切る副作用だけを退役できている。
