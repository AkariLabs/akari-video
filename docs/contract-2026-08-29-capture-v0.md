# `akari capture` 契約 v0 — 今の edit.json の完成フレームを、書き出さずに見る

- 日付: 2026-08-29
- 状態: **v0（オーナー裁定済み 2026-08-29・実装未）**。実装タスクで判明した齟齬は追記で解消する
- 前提:
  - `contract-2026-08-02-preview-parity.md`（プレビュー・書き出しの一致。本契約は**第 3 の出口**を加える）
  - `contract-2026-07-22-render-basics.md`（render-cut の合成順序・ffmpeg 実装の制約）
  - `contract-2026-07-25-project-structure-v0.md`（`.akari/reports/` = 検証証跡）
  - `contract-2026-08-29-media-inspect-cli-v0.md` §1.1（コンタクトシートの共通仕様）
- スコープ: プロジェクトの `edit.json`（+ captions.json + overlays + layers + fx + LUT）を、タイムライン時刻 T で合成した
  **完成フレーム**を静止画で返す CLI。音声は扱わない
- 姉妹契約: `contract-2026-08-29-media-inspect-cli-v0.md`（素材そのものを見る `akari media`）

## 0. 位置づけ — 一言で言い切る

**「出力としてこう見えている」を、人間も AI も、書き出さずに確認できる状態にする。**

render-cut は完成 MP4 を作る道具で、数分〜数十分かかる。字幕・オーバーレイ・PiP・FX が**重なった**結果を確かめたいだけの
ときに全部書き出すのは重すぎるし、エージェントが「今のカットはこう見えます」と示す手段も無かった
（`akari internal beat-sync-probe-frame` はオーバーレイ層だけを撮る）。`capture` は時刻を渡すと完成フレームを返す。
副次用途として、`--full` のフル解像度 1 枚は**サムネイルの元絵・切り抜き素材**になる（オーナー 2026-08-29）。

### 一致の物差し（この契約の中心）

**`capture` が返すフレーム ≡ 書き出し（render-cut）がエンコーダに渡すフレーム**。

preview-parity 契約は「どちらの UI でも同じ入力は同じ見た目」を定めている。本契約はそこに
**capture を第 3 の出口として加える**: プレビュー / 書き出し / capture の 3 つは同じ時刻 T に同じ絵を返す。
エンジン v2（「時刻 T → 完成フレーム」の評価関数を 1 つだけ持つ構想）では capture はその関数の出口そのもので、
一致は構成上自動になる。v0 は render-cut の経路で同じ合成を 1 フレームだけ行うことで一致を作る（§3）。
以後、capture と書き出しの差はバグとして扱う。

## 1. CLI

```
akari capture [-p <project>] (-t <time…> | --auto) [--separate] [--full] [--per-sheet <n>] [--out <dir>] [--edit <path>]
```

| 引数 | 意味 |
|---|---|
| `-p <project>` | プロジェクト root（既定: cwd から `.akari/` を祖先に探す） |
| `-t <time…>` | **タイムライン秒**（書き出し結果の時刻。source 秒ではない）。1 個以上。`MM:SS(.fff)` も可 |
| `--auto` | render-cut と同じ代表時刻を決定論で導出（`deriveContactSheetTimestamps`: 冒頭・各カット境界の直後・各オーバーレイ / 字幕区間の中点・終盤）。`-t` と併用可（和集合） |
| `--separate` | 時刻ごとに 720p 高さの PNG 1 枚 |
| `--full` | 時刻ごとに**出力解像度（`output.width × height`）の PNG 1 枚**。ラベルの焼き込み無し・sRGB・不透明。サムネイル / 切り抜き用 |
| `--per-sheet <n>` | シート 1 枚あたりのコマ数（1〜12） |
| `--out <dir>` | 出力先（既定 `.akari/reports/capture/<stamp>/`） |
| `--edit <path>` | 既定 `<project>/edit.json` 以外を合成したいとき（比較用） |

- stdout は JSON Lines（1 行 1 画像）。stderr は人間向け。exit `0` / `1` は `akari media` と同じ規約

```jsonc
{ "kind": "sheet", "timecode": "0f-11s", "times_s": [0, 4.5, 11], "path": ".akari/reports/capture/20260829T100000Z/0f-11s.png" }
{ "kind": "frame", "timecode": "04s15f", "time_s": 4.5, "path": ".akari/reports/capture/20260829T100000Z/04s15f-full.png", "width": 1920, "height": 1080 }
```

- 出力ディレクトリに `capture.json` を 1 つ書く: 上記の全行 + `edit_sha256` + `captions_sha256` + 使った素材の `sha256` +
  `renderer`（`render-cut@<version>` / 将来 `engine-v2@…`）+ `generated_at`。**どの edit.json から撮ったか**を後から突合できるようにする
- 実装は `packages/akari-tools/bin/capture.mjs`（render-cut / puppeteer 依存側）。launcher は `capture-command.mjs` から遅延解決して子プロセス起動

## 2. 何が映るか（= render-cut が時刻 T で合成する全部）

| 要素 | 扱い |
|---|---|
| カット（`cuts[]`）と source 写像 | タイムライン秒 T → (`src`, source 秒) は render-cut と同じ写像（`cut-timeline.mjs`）。フリーズ・尺伸びも同じ |
| 画角（crop / transform / perspective）・レイヤー・キーフレーム | render-cut と同じ数式（`cut-framing` / `layer-keyframes` / `perspective-homography`） |
| 字幕（captions.json）・強調語・カラオケ | 時刻 T で表示されるべき状態を、書き出しと同じラスタライズで |
| オーバーレイ HTML（overlays[]） | `renderOverlaySheet` / `captureWithPuppeteer` と同じ経路。アニメーションは**シーク同期**（CSS animation pause + `currentTime` 手動セット）で T の状態を撮る |
| FX・LUT・トランジション・マスク | render-cut と同じフィルタ。近似バッジ付きの FX はそのまま近似（書き出しと同じ絵であることが要件） |
| 音声 | **扱わない** |
| 未保存の編集 | 扱わない。shell のタイムライン編集は shell が `edit.json` に保存してから（保存前の状態を撮る機能は後続） |

## 3. 実装 v0（render-cut 経路）と v2 への継ぎ目

- render-cut の中に **「時刻 T の完成フレームを 1 枚返す」関数**を切り出す（例: `packages/render-cut/src/frame-at.mjs` の
  `renderFrameAt({ plan, timeS, outputPath })`）。既存の書き出し経路（`renderProject` → `rasterizeAndComposite`）が持つ
  合成順序・フィルタ式・enable 窓（`enableWindowExpr` の半開区間）を**共有**し、単一フレームは同じ式に
  `-ss <T>` / `-frames:v 1` を当てるだけにする。**式を二重に持たない**（二重化は preview-parity 契約が既に払った請求書）
- オーバーレイは `probe-frame.mjs` が既にやっている「本番と同じオーバーレイシートを時刻 T で 1 枚」を流用し、
  素材フレーム + 字幕 + オーバーレイ + FX を同じフィルタチェーンで合成する
- `renderFrameAt` は**エンジン v2 の継ぎ目**でもある。v2 では同じシグネチャの実装が GPU コンポジタに差し替わり、
  capture / プレビュー / 書き出しが同じ関数を呼ぶ
- `akari internal beat-sync-probe-frame` は本コマンド実装後に **1 リリース互換を残して退役**（beat-sync-edit スキルの参照を `capture` へ）
- コンタクトシートは `contact-sheet.mjs` を共用（`akari media` 契約 §1.1）

## 4. 一致の検収（受け入れ条件の核）

- フィクスチャ（カット 3 + 字幕 + オーバーレイ 1 + レイヤー 1 + FX 1 を含む小さな edit.json）で、
  **同じ T の capture と render-cut 出力フレームを比較**する。比較先は書き出しの非可逆劣化を除くため、
  render-cut を可逆または高品質設定（ProRes 4444 / `-crf 0` / PNG 連番のいずれか。タスクで決めて記録）で回した中間物から抜く
- 合格線: 平均絶対差 ≤ 2/255 かつ最大差のある画素が 0.1% 未満（サブピクセルのラスタライズ差を許容）。
  それを超える差は**バグ**として原因を特定して直すか、既知差分として契約に追記する（preview-parity 契約 §2.4 と同じ流儀）
- 同じ入力で 2 回撮って**バイト一致**（決定論）
- `--auto` の時刻列が render-cut の `render.json` `contact_sheet.timestamps_seconds` と一致する

## 5. 帳面との関係

- capture は**素材**ではなく**編集（edit.json）**の観察なので、素材の帳面（analysis.json）には書かない。
  記録は `capture.json`（§1）と、呼び出したスキル側のレポート（`critique-cut` の `critique.md` 等）が持つ
- `.akari/reports/capture/` は検証証跡（project-structure v0 §1）。再生成可能だが自動削除はしない（render-report と同じ扱い）

## 6. 非スコープ

- 音声・動画クリップの書き出し（render-cut の仕事）
- shell の「この時刻を撮る」ボタン（後続。CLI が先）
- 未保存編集の撮影
- プレビュー側（Web UI / shell）との一致検収は preview-parity 契約の既存手順に委ねる。本契約が検収するのは capture ≡ 書き出し

## 7. 受け入れ条件（実装タスクの物差し）

- `akari capture -t 0 4.5 11` がフィクスチャで 3 コマのシート 1 枚と `capture.json` を返し、stdout が JSON Lines のみ
- `--separate` / `--full` / `--per-sheet` / `--auto` / `--edit` がそれぞれ契約どおり
- §4 の一致検収がテストとして存在し全緑（比較方式・許容値をテスト内に明記）
- `renderFrameAt` が render-cut 本体からも呼ばれ、書き出し経路と capture 経路で合成式の定義箇所が 1 つであること
  （grep で `enableWindowExpr` 以外に enable 式の組み立てが増えていない）
- 既存の render-cut テスト（295 件規模）が全緑・書き出しの成果物が変わらない（既存フィクスチャの SHA-256 不変）
- launcher: `akari capture --help` / akari-tools 不在時の案内 / Chrome 不在時の案内（`findChromePath` の既存メッセージを再利用）

## 9. v1 改訂（2026-08-30）— v2 経路への載せ替え

### 9.1 なぜ改訂するか（確定事実）

- v0 の実装は `packages/akari-tools/src/capture/run.mjs` が `renderProject(…, { engine: "legacy" })` を**固定**で呼び、
  `packages/render-cut/src/frame-at.mjs` が旧 ffmpeg フィルタグラフの `plan.commands` を先頭から対象フレームまで回す
  （オーバーレイの段は `captureWithPuppeteer` で 0..T の全コマを撮る）。**v2（osr / gpu）を通っていない**
- 2026-08-28 #90 で**書き出しの既定は v2**になった（`resolveEngineChoice("auto")` = macOS は GPU 直結〔適格時〕/ OSR、非 macOS は legacy）。
  §0 の物差し「capture ≡ 書き出し」は、既定の書き出し = v2 に対して取り直さなければ意味を失う
- 実案件（v2・トラックあり・Three.js オーバーレイ入り・11 秒）で v0 は **18 分 50 秒**（critique-cut 1 周の 98.7%）。
  §0「書き出さずに見る」の目的に反する

### 9.2 v1 の仕様（§1〜§7 に対する差分。書いていない項目は v0 のまま）

- **`--engine auto|osr|gpu|legacy`** を追加（既定 `auto`）。解決は render-cut の `resolveEngineChoice` / GPU 適格判定を**同じ関数で**行い、
  書き出しの `auto` と必ず同じエンジンに落ちる（capture が書き出しと違うエンジンを選ぶことは無い）
- **v2 経路 = 書き出しと同じページを組み、フレーム N だけを評価して 1 枚にする。0..N を回さない**
  - ページは render-cut が `exportWithOsr` / `exportWithGpu` に渡すものと同一（`page-builder` の入力 = edit / captions / overlays / width / height / fps）
  - osr: `osr-export/src/electron-main.mjs` のフレームループ（seek → capturePaint → verifyStamp → 書き込み）を**フレーム N の 1 回**だけ回し、
    エンコードせずに `stripStampRow` 後のビットマップを PNG に落とす。verify（stamp 一致 = N）は省略しない
  - gpu: `gpu-export` の page-runtime にフレーム N の単発評価（frame-engine `evaluateFrame` 1 回）+ 読み戻し（`frame-engine/src/exits/readback.ts`）→ PNG。
    字幕スプライト・HTML-in-Canvas・3D は書き出しと同じ経路を通す（不適格なら `auto` は書き出しと同様に osr へ落ちる）
  - 複数時刻はページ起動を 1 回にして N を順に評価する（Chrome / Electron を時刻ごとに立ち上げない）
- **legacy 経路（frame-at.mjs）は `--engine legacy` 明示時と非 macOS のフォールバックだけ**。削除しない
- **`capture.json`** に `engine`（requested / resolved / fallback）と `renderer`（`osr-export@<version>` / `gpu-export@<version>` / `render-cut@<version>`）を書く。
  **同じページ・同じランタイムを通ったこと**を receipt で示す（osr / gpu の receipt から stamp / verify の結果を写す）
- **コンタクトシートは `contact-sheet.mjs` の `renderLabeledContactSheet`（media 契約 §1.1・≤ 2576×1456）へ差し替える**。
  v0 独自タイラー（1 コマ 720p 固定・上限なし → 4×3 で 5120×2160）は廃止
- 性能目標（受け入れ条件）: v2 の fieldtest 案件（内部リポ `fieldtest/2026-08-29-critique-cut-v2`・11 秒・1080p・HTML オーバーレイ 2〔Three.js 含む〕・字幕・LUT）で
  **1 枚 ≤ 10 秒、3 枚 ≤ 20 秒**（ページ起動込み）。**尺に比例しない**こと（同案件の尺を 2 倍にしても ±2 秒以内）

### 9.3 一致の物差し（v1）

- **capture(engine, N) ≡ 書き出し(同じ engine) のフレーム N**。比較先は同じ `--engine` で書き出した mp4 から `-ss` で抜いたフレーム。
  書き出しは非可逆なので許容値は既存の v2 パリティ基準（overlay 矩形 MAD ≤ 1.0）に揃え、§4 の「平均絶対差 ≤ 2/255・最大差画素 < 0.1%」は
  可逆比較ができる経路（gpu の読み戻し同士）でだけ要求する
- **同一性の構造的証明**: capture と書き出しが**同じ page-builder・同じ page-runtime・同じ verify**を通ることをコードで示す
  （capture 専用の合成式・専用のページを持たない）。`grep` で capture が `plan.commands` を参照しないこと（legacy 経路以外）
- 決定論: 同じ入力で 2 回撮ってバイト一致（osr は GPU 依存の差が出うるため、既存の osr 決定論基準〔HW 2 走 SHA〕に従う）

### 9.4 非スコープ

- page-runtime の新機能（字幕・HTML・3D の到達範囲は #120b〜f の契約が決める。capture はそれに乗るだけ）
- GPU 適格判定の変更
- プレビュー（shell / Web UI）からのスクショ機能（エンジン v2 では同じ関数になるため不要）
- v0 の legacy 経路の高速化（`--engine legacy` は現状維持）

## 8. 変更履歴

- 2026-08-30: §9 v1 改訂 — v2 経路（osr / gpu の page runtime でフレーム N を単発評価）へ載せ替え。v0 が legacy 固定だった事実と実案件 18m50s を記録。シートは media の共用関数へ
- 2026-08-29: v0 起草（オーナー裁定「render-cut を呼ばずに重なった完成絵を確認したい」「サムネイルにも」を反映。裁定の経緯は非公開の内部記録で管理）
