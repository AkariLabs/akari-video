---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-30
---

# S12 インスペクタ書き戻し e2e 検証手法（退役済み）

> **退役（2026-08-30）**: 本台本が操作していたプレビュー内インスペクターは
> コミット `b49692f1` で撤去されたため、台本を退役した。現行のインスペクター e2e は
> [`run-l1.sh`](../../../akari-annotations/evidence/inspector-sections-v1/scripts/run-l1.sh) を使う。
> 以下は CDP・ターゲット選び・既知の地雷を再利用できる技術記録として残す。

タスク: `2026-07-16-s12-e2e-method`。3 サイクル連続で `unverified_risks` に残っていた
「プレビュータブのインスペクタで値を触ると edit.json に書き戻る」の end-to-end 検証を、
**実際に UI 操作（ダブルクリックでファイルを開く → 動画をシーク → オーバーレイをクリックして
選択 → インスペクタのフィールドにキーボードで値を入力 → フォーカスを外す）から
edit.json への実書き込みまで、本物のヒットテスト付きマウス/キーボードイベントで貫通させる**
手法として 2026-07-16 に確立した記録である。

**結論を先に書く: 貫けた。** Theia の `WebviewWidget` が作る二重 iframe
（外側 `webview/index.html` → 内側 `active-frame`）の内部まで、Chrome DevTools Protocol
（以下 CDP）の生クライアントで到達し、実際にオーバーレイを選択・値を書き換え・
`edit.json` の実ファイル diff を確認した。当時の手順は
[`retired/run-inspector-writeback-e2e.mjs`](./retired/run-inspector-writeback-e2e.mjs)
として保存してあり、依存追加なし（Node.js 22+ 組み込みの `fetch`/`WebSocket` のみ）。

## 前提・環境

- 実測環境: Electron 39.8.7 / Chromium 142（`apps/shell/package.json` 固定バージョン）、
  macOS darwin-arm64。Node.js v26.3.0 で実行（`fetch`/グローバル `WebSocket` が必要 = Node 22+）
- `apps/shell` は事前に `npm run build`（`build:ext` + `theia build --mode production`）
  済みで、`node_modules/electron/dist/` に実体展開済みであること
  （`verify` スキル L1 節の手順どおり。electron の allow-scripts ゲート回避も同様）
- 追加 npm 依存はゼロ。プロダクトコード・`package.json` は一切変更していない

## 確立した手法

### 1. 検証用フィクスチャを作る（リポ外の scratch ディレクトリ、コミットしない）

```sh
mkdir -p <SCRATCH>/workspace/.theia <SCRATCH>/workspace/exports/overlays
printf '%s\n' '{"akari.developerMode": true}' > <SCRATCH>/workspace/.theia/settings.json
ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=6 \
  -f lavfi -i sine=frequency=440:duration=6 \
  -pix_fmt yuv420p -c:v libx264 -c:a aac -shortest \
  <SCRATCH>/workspace/exports/sample.mp4
```

`<SCRATCH>/workspace/exports/edit.json`:

```json
{
  "version": 0,
  "source": { "path": "sample.mp4" },
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "overlays": [
    {
      "id": "cap-a",
      "html": "overlays/cap-a.html",
      "start": 1,
      "duration": 4,
      "transform": { "x": 100, "y": 560, "scale": 1, "rotate": 0 },
      "vars": { "--color": "#ffcc00" }
    }
  ]
}
```

developer mode は活動バーの「素材」をカード棚ではなく Explorer に切り替えるために必要。
`version: 0` は `prepareLegacyEdit` の版要求を満たし、`source.path` は edit.json がある
`exports/` ディレクトリ基準で解決されるため `sample.mp4` とする。
UI で直接開くのは `sample.mp4` ではなく `edit.json`。前者の単体プレビューには
`[data-overlay-id="cap-a"]` が無く、後者の合成出力プレビューでだけ overlay が描画される。

`<SCRATCH>/workspace/exports/overlays/cap-a.html`（`--color` を実際に消費する断片）:

```html
<div style="font: 700 28px sans-serif; color: var(--color); padding: 8px 12px; background: rgba(0,0,0,0.55); border-radius: 6px;">S12 e2e caption</div>
```

### 2. Electron を実機起動する（`verify` スキル L1 節と同じ手順）

```sh
cd apps/shell
mkdir -p <SCRATCH>/userdata <SCRATCH>/config
THEIA_CONFIG_DIR=<SCRATCH>/config \
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$(pwd)" "<SCRATCH>/workspace" \
  --remote-debugging-port=9333 --user-data-dir=<SCRATCH>/userdata --no-sandbox
```

### 3. 退役済み検証スクリプトの実行記録

> このコマンドは 2026-07-16 時点の再現記録であり、現行シェルでは step 7 以降へ
> 到達できない。現行の検証には
> [`run-l1.sh`](../../../akari-annotations/evidence/inspector-sections-v1/scripts/run-l1.sh) を使う。

```sh
node retired/run-inspector-writeback-e2e.mjs 9333 <SCRATCH>/workspace exports/sample.mp4 <SCRATCH>/evidence
```

第3引数はフィクスチャ内の `edit.json` の所在（親ディレクトリ）を決めるために使う。
実測では `sample.mp4` を直接開くと overlay は `visibility: "no-container"` だが、
`edit.json` を開くと実クリック選択まで成立した。

スクリプトは以下を**全部 UI 操作として**実行し、各ステップの実測値を stdout と
`<evidenceDir>/run-log.json` に記録する:

1. 俯瞰タブしか無い起動直後の状態から、developer mode でのみ活動バーに出る Explorer を実クリックで開く
   （既に開いていればスキップ = 開閉トグルなので二重発火させない）
2. `exports` フォルダ行を実ダブルクリックで展開（既に展開済みならスキップ）
3. `edit.json` 行を実ダブルクリックし、合成プレビューの `akari-preview` タブを開く
4. `/json/list` を polling し、二重 iframe の**外側**（`webview/index.html`）が
   独立した CDP ターゲット（`type: "iframe"`）として現れるのを待つ。そのターゲットへ
   直接接続し、`Runtime.executionContextCreated` で得た各 context を評価して、
   `#preview-video` を持つ内側 context が現れるまで最大30秒待つ
5. 動画を `currentTime=2`（オーバーレイの `start=1 duration=4` の範囲内）へシークし、
   `window.akari.runtime.tick()` を呼んでオーバーレイを描画させる
6. オーバーレイ断片（`[data-overlay-id="cap-a"] > firstElementChild`）の実座標へ
   `Input.dispatchMouseEvent`（mouseMoved → mousePressed → mouseReleased）を発行し、
   **実際にヒットテストされたクリック**でオーバーレイを選択させる
   （`data-akari-interaction-selected="true"` になることを確認）
7. インスペクタの `--color` 入力欄の実座標へ実クリックでフォーカスし、
   `Home` → `Shift+End` の実キーイベントで全選択、`Input.insertText` で
   `#00c853` を実際に入力する
8. 動画エリアを実クリックしてフォーカスを外す（ネイティブ `change` イベント発火）
9. `edit.json` を実ファイルとして読み、`--color` が `#ffcc00` → `#00c853` に
    変わっていることを確認する

## 実測ログ（このリポジトリの evidence）

`../../evidence/e2e-method/` 配下:

以下の evidence PNG はすべて **retired（2026-07-16 時点の記録）** であり、
現行 UI の合格証跡ではない。

| ファイル | 内容 | 状態 |
|---|---|---|
| `00-boot.png` | 起動直後（俯瞰タブのみ） | retired（2026-07-16 時点の記録） |
| `01-preview-opened.png` | `edit.json` を実ダブルクリックして合成プレビューを開いた直後（`0:00`、オーバーレイは時間窓外で非表示） | retired（2026-07-16 時点の記録） |
| `02-overlay-visible.png` | `currentTime=2` へシーク後（オーバーレイ `S12 e2e caption` が黄色 `#ffcc00` で表示） | retired（2026-07-16 時点の記録） |
| `03-overlay-selected-inspector-open.png` | オーバーレイを実クリックで選択後（選択枠+ハンドルが表示され、右にインスペクタが開き `--color: #ffcc00`） | retired（2026-07-16 時点の記録） |
| `04-value-typed.png` | `--color` 欄に実キーボード入力で `#00c853` を入力した直後（オーバーレイの文字色が即座に緑へ変化） | retired（2026-07-16 時点の記録） |
| `05-after-blur-writeback.png` | 動画エリアをクリックしてフォーカスを外した後（値は `#00c853` のまま維持） | retired（2026-07-16 時点の記録） |
| `edit-before.json` / `edit-after.json` | 操作前後の `edit.json` 全文 | 2026-07-16 時点の記録 |
| `edit-json.diff` | 上記の unified diff（`vars["--color"]` のみが変化し、他フィールド非破壊であることを確認） | 2026-07-16 時点の記録 |
| `run-log.json` | 上記手順 1〜10 の各ステップの実測値（座標・タイムスタンプ・DOM 状態）の構造化ログ | 2026-07-16 時点の記録 |
| `repro-playwright-frame-flakiness.json` | 後述「試して駄目だった方向 1」の実測ログ | 2026-07-16 時点の記録 |
| `negative-control-toplevel-click.json` | 後述「試して駄目だった方向 2 / 補足知見」の実測ログ | 2026-07-16 時点の記録 |

実際の diff（`edit-json.diff` の要旨）:

```diff
-      "vars": { "--color": "#ffcc00" }
+      "vars": {
+        "--color": "#00c853"
+      }
```

`run-log.json` の結論エントリ:

```json
{ "step": "result", "ok": true, "expected": "#00c853", "actual": "#00c853" }
```

## この手法で検証できる範囲・できない範囲

**検証できた範囲（実測で確認済み）**:

- UI イベント（ファイルツリーの実ダブルクリック・オーバーレイの実クリック・
  インスペクタ入力欄への実キーボード入力・フォーカスアウト）→
  `packages/overlay-runtime/src/interaction.js` のイベントハンドラ
  （`onClick`/`selectOverlay`/`persist()`）→
  `akari-preview-open-handler.ts` の `handleOverlayWrite()` →
  `FileService.writeFile()` → `edit.json` 実書き込み、という**経路全体**を
  実際のマウス/キーボードイベントで一気通貫させ、ファイルの実 diff で確認した
- 座標は全てスクリプトが実行時に DOM から動的取得したもの（ハードコードされた
  ピクセル値ではない）ため、レイアウトが変わっても再実行可能
- 冪等性: エクスプローラーの開閉・フォルダの展開/折り畳みはトグルなので、
  スクリプトは現在の状態を見てから操作するようにしてある（既に開いている状態から
  再実行しても壊れない）

**検証できていない範囲（正直に書く）**:

- **ドラッグによる移動・拡縮ハンドルでの拡大縮小**: `interaction.js` には
  `pointerdown`→`pointermove`→`pointerup` のドラッグ操作もあるが、本スクリプトは
  クリック（選択）とテキスト入力（インスペクタの値変更）のみを検証した。
  ドラッグは `Input.dispatchMouseEvent` の `mouseMoved` を複数回発行すれば同じ
  仕組みで到達できるはずだが未実施（S12 の受け入れ条件はインスペクタの値変更が
  本丸のため対象外とした）
- **ダブルクリックによるテキスト直接編集**（`interaction.js` の `onDoubleClick`/
  `beginEdit`）は本タスクの対象外（S12 の "インスペクタ書き戻し" 要件に含まれない）
- **他プラットフォーム（Windows/Linux）・他 Electron バージョンでの再現性**は未確認
  （後述「地雷」参照。ダブル iframe の CDP ターゲット構造がバージョン依存の可能性あり）
- **4K・長尺素材でのオーバーレイ操作**: フィクスチャは 6 秒・1280x720 のテスト
  パターンのみ

## 試して駄目だった方向（次の人が同じ壁に当たらないために）

### 1. Playwright の `page.frames()` / `frameLocator()` / `childFrames()` 再帰探索

**結論: 使えない。実測で確認した。**

`chromium.connectOverCDP()` で接続し、`sample.mp4` を開いた直後に `page.frames()` を
呼ぶと、**まれに**外側・内側の 2 枚とも URL 付きで列挙されることがあるが（1 回だけ
観測）、それ以外のほぼ全ての試行では以下のいずれかになった:

- `page.frames()` が `[main, '']`（2 番目の frame の `url()` が空文字列）を返し、
  内側の `active-frame` が全く見えない
- `page.mainFrame().childFrames()` を再帰的に歩いても、空 URL の 1 階層しか
  見つからず、その先の子フレームが存在しないものとして扱われる（実際には
  内側に `active-frame` が存在するのに）

6 回の polling スナップショットを取った実測ログが
`repro-playwright-frame-flakiness.json`。全スナップショットで内側フレームへの
到達に失敗している。**Playwright の高レベル Frame API は、外部プロセスに
`connectOverCDP` した場合の OOPIF（Out-of-process iframe）追跡が弱く、
今回の二重 iframe 構造では実用にならない**、というのが 3 サイクル分の
`unverified_risks` の実体だったと考えられる。

### 2.（教訓）生 CDP でも「間違ったターゲット」に投げると意味がない

`/json/list` を見ると、外側 iframe（`webview/index.html?id=...`）は
**それ自体が独立した CDP ターゲット**（`"type": "iframe"`、専用の
`webSocketDebuggerUrl` を持つ）として現れる。ここへ**直接** CDP 接続し、
その中で改めて `Page.getFrameTree` を呼ぶと、内側の `active-frame` が
子フレームとして正しく見える。**この「外側ターゲットへ直接つなぎ直す」のが
今回のブレークスルー**であり、`Runtime.executionContextCreated` イベントの
リスナー登録を `Runtime.enable` より**前**に済ませておく必要がある点も注意
（後から登録すると、enable 時に一括発火する既存コンテキストの通知を取りこぼす）。

### 3. 補足知見（次の一手を減らすための実測記録）

メイン（トップレベル）ページターゲットに対して直接 `Input.dispatchMouseEvent` を
投げても、外側 iframe の画面上の座標へ正しく変換すれば、実は選択に成功した
（`negative-control-toplevel-click.json`）。過去サイクルの報告
（`preview-streaming` タスク report.md）は「`Input.dispatchMouseEvent` は
トップレベルターゲットでしか実行できない」という制約を明記しているが、
**本検証で使った Electron/Chromium バージョン（39.8.7 / 142）では、
トップレベルターゲットへの入力でも二重 iframe を越えてヒットテストされた**。
これは Chromium のバージョン間でこの挙動が変化した可能性を示唆する
（当時の報告がどのバージョンで検証したかは report.md に記載がなく特定できない）。

**したがって本手法が移植可能な核心は「どのターゲットに入力を送るか」ではなく
「`Page.getFrameTree` + `Runtime.executionContextCreated`（`auxData.frameId`
突き合わせ）で内側フレームの実行コンテキストを正確に特定すること」である。**
これができれば、DOM 読み取り・状態確認は内側コンテキストへの `Runtime.evaluate`
で行い、入力はどちらのターゲットに投げても（本環境では）到達する。移植先の
Chromium バージョンで後者が効かない場合は、外側ターゲットへ直接つなぎ直す
退役済みスクリプトの方式（`run-inspector-writeback-e2e.mjs` が実際に採用している方式）
を使えば良い。

### 4. 地雷（実装中に踏んだ・スクリプトで回避済み）

- **ダブルクリックは 2 回の press/release サイクルが必要**:
  `Input.dispatchMouseEvent` で `clickCount: 2` を 1 回の press/release ペアだけで
  送っても Chromium はダブルクリックと認識せず、ツリーの展開/ファイルオープンが
  発火しない。`clickCount: 1` の press/release → 短い待機 → `clickCount: 2` の
  press/release、という 2 サイクルが必要
- **アクティビティバーのアイコンは開閉トグル**: 既に Explorer が開いている状態で
  同じアイコンをクリックすると閉じてしまう。状態を見てから条件付きでクリックする
  必要がある（さもないと `.theia-TreeNode` の `getBoundingClientRect()` が
  全て `0,0,0,0` を返し、原因不明のバグに見える罠がある）
- **クリック対象は「断片」であって「コンテナ」ではない**: `[data-overlay-id="..."]`
  自体は `position:absolute; inset:0` でステージ全体を覆う透明な当たり判定であり、
  その座標でクリックしても選択はされる（`interaction.js` の JS 側フォールバック
  hit-test があるため）が、**インスペクタの入力欄の座標を正しく取るには
  実際に見えている断片（`firstElementChild`）の矩形を使うこと**
- **書き戻しは blur ではなくデバウンスタイマーで先に起きる**: `interaction.js` の
  `input` イベントリスナーは 200ms のデバウンスで `persist()` を呼ぶ。blur 時の
  `change` イベントでも `persist()` は呼ばれるが、**先に 200ms 側で書き込みが
  完了している**。before/after のスナップショットは「タイプする前」「タイプ後
  十分待ってから」で取ること（blur 直前に before を撮ると、その時点で既に
  after の値になっていて diff が出ない）

## 後続タスクへの示唆

`run-inspector-writeback-e2e.mjs` 自体は退役済みであり、後続タスクが `verify` スキルの
L1 として現行インスペクターを検証する場合は後継の
[`run-l1.sh`](../../../akari-annotations/evidence/inspector-sections-v1/scripts/run-l1.sh) を使う:

```sh
AKARI_FIELDTEST_DIR=<v2-project> AKARI_FIELDTEST_V1_DIR=<v1-project> \
  bash ../../../akari-annotations/evidence/inspector-sections-v1/scripts/run-l1.sh
```

退役済み台本の再現条件は、フィクスチャに overlay id `cap-a` と `--color` var があること
（本 README §1 のとおり）。これは現行 L1 の前提ではない。

## 退役理由（2026-08-30）

README §1 のフィクスチャを使った現行シェルでの実測では、台本の step 1〜6
（Explorer を開く → `edit.json` の合成出力プレビューを開く → 二重 iframe へ到達 →
シーク → overlay を実クリックで選択）は通る。一方、プレビュー webview の DOM には
`#inspector` / `#inspector-fields` が無く（`hasInspector: false`）、step 7 以降は到達不能。

この UI はコミット `b49692f1`「[akari-annotations] インスペクター編集可能化 +
オーバーレイ編集の一本化」で撤去され、右パネルの akari-annotations インスペクターへ
移設済み。アサーション内容を変えない本台本では右パネル経路へ置き換えず、step 7 で
明確なエラーとして報告する。
