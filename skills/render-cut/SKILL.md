---
name: render-cut
description: 承認済み edit.json と edit-lint PASS を入力に、最終 MP4 の計画、明示承認、ローカル書き出し、ffprobe 検証、キーフレーム視認を完了する。編集が承認済みで、納品用動画の書き出しや最終レンダーを求められたときに使う。
---

# 承認済み編集を書き出す

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

1. **edit.json を正本に決定的コマンド生成。自然言語からの即興 ffmpeg 禁止**
   （エージェントが ffmpeg コマンドを手書きして「これで書き出しました」は契約違反）
2. **plan なしの render 禁止**（validate→plan→承認→render の順を飛ばさない）
3. **edit-lint FAIL のままの render 禁止**（override は承認ゲート + render.json 記録）
4. **レンダー後の ffprobe 機械検証必須**。verify fail の成果物を納品可能と報告しない
5. **既定はローカル ffmpeg のみ**。クラウド有償 API（Rendi 等）は v0 不採用
   （将来はオプトイン + manage-connections の承認ゲート経由でのみ検討）
6. **原本 source からレンダ**（proxy を最終レンダに使わない）
7. **状態は render.json・HTML は可視化のみ**（新規サーフェス機構を輸入しない）
8. **外部候補のコード転写禁止**（Kinocut / json-to-ffmpeg は構造参考のみ）
9. **既存成果物の silent 上書き禁止**
10. カット連結・合成・verify の ffmpeg / ffprobe は**本体直叩き**（ラッパーライブラリ
    禁止。分析・書き出し・検証の各工程で共通の方針）。
    **例外は HTML ラスタライズ段の HyperFrames のみ**（依存は
    `packages/render-cut/` 内に隔離し、リポの他所へ波及させない）
11. **3D overlay は puppeteer-core 経路で焼かれる**（HyperFrames より速度差があり得る点に注意）

## 実行手順

### 実行体の解決

第一手として `akari doctor --json` を実行し、`render_cut.path` を `<render-cut>`、
`cli.node.exec_path` を node の実行体として使う。まだこれらのフィールドを出力しない版なら、
次の探索へ進む。

次の 3 形態を表の上から `ls` し、最初に存在した `<render-cut>` を使う。

| 形態 | macOS | Windows |
|---|---|---|
| (a) デスクトップアプリ同梱 | `<App>/Contents/Resources/packages/render-cut/bin/render-cut.mjs`（`<App>` の既定は `/Applications/AKARI Video.app`） | `<install dir>\resources\packages\render-cut\bin\render-cut.mjs` |
| (b) `install.sh` 経路 | `~/.akari/app/packages/render-cut/bin/render-cut.mjs` | `%USERPROFILE%\.akari\app\packages\render-cut\bin\render-cut.mjs` |
| (c) モノレポ | `<repo>/packages/render-cut/bin/render-cut.mjs` | `<repo>\packages\render-cut\bin\render-cut.mjs` |

(a) のデスクトップアプリだけを使う利用者には `~/.akari/app` は存在しない。

node の解決順は `AKARI_NODE_BIN` → PATH の node（20 以上）→ 同梱 Electron を
`ELECTRON_RUN_AS_NODE=1` で node として使う、の順とする。以下の `node` はこの手順で解決した
実行体、`<render-cut>` は上で解決した実行体パスを表す。

1. 対象プロジェクトの `edit.json` が承認済みで、`.akari/lint.json` の `verdict` が `pass` であることを確認する。PASS でなければ `edit-lint` を実行して修正する。`--force` は lint 結果を上書きする明示承認を得た場合だけ使う。
2. plan だけを生成する。

   ```sh
   node <render-cut> <project-root> --plan-only
   ```

3. `<project>/.akari/render.json` と `<project>/.akari/reports/render-report.html` を読み、予測尺、出力先、ffmpeg コマンド列、中間物、ラスタライズ候補、入力ハッシュを提示する。
4. **今回の書き出し実行に対する人間の明示承認を得て停止を解除する。** 無応答、過去の包括承認、plan 以前の承認を今回の承認に読み替えない。
5. 承認後だけ書き出しを実行する。

   ```sh
   node <render-cut> <project-root>
   ```

   出力を明示する場合だけ `--out <path>` を加える。CLI の validate → plan → render → verify を分解して手作業で代替しない。
   GPU 直結を明示する場合は `--engine gpu` を加える。CSS animation / transition / `@keyframes` /
   Web Animations / `@property` だけで動く HTML は DOM 層として適格。`words[]` の karaoke / pop /
   reveal / reveal-word と対応済み `emphasis_words` は GPU-native 適格。宣言型 3D のルート 1 要素だけにある
   opacity + 2D translate / scale の 2 点登場 animation も GPU-native 適格。不適格な字幕・HTML があれば
   理由付きで fail-closed になり、`--engine auto` は macOS で適格時だけ GPU、それ以外は OSR を選ぶ。
6. exit code と `.akari/render.json` を確認する。`0` は完走して verify PASS、`1` は拒否または verify FAIL、`2` は実行エラーを表す。`provenance.rasterizer` で採用手段と上位候補を落とした理由を確認する。`verify.findings` には
   尺・フレーム数厳密一致（`verify.frame-count`）・全フレームデコード成功（`verify.decode`）・解像度・fps・コーデック等が並ぶ。
7. verify PASS 後、CLI が `<project>/.akari/reports/contact-sheet.png` へ自動生成したコンタクトシート（plan から決定論導出した代表時刻 — 冒頭・各カット境界の直後・各オーバーレイ/字幕区間の中点・終盤 — をタイル結合した静止画。`render.json` の `contact_sheet.timestamps_seconds` に時刻列を記録）をキーフレーム視認の起点にする。これで足りない区間（コンタクトシートの上限枚数を超えて間引かれた箇所など）だけ追加でフレーム抽出して視認する。カット元時刻、文字、位置、欠落、透明合成を確認する。
8. 機械検証値、成果物 SHA-256、採用したラスタライズ手段、フォールバック理由、コンタクトシート起点のキーフレーム視認結果を報告する。verify FAIL の場合は納品可能と表現せず、`.akari/render-tmp/` を保持して原因を報告する。

## 出力契約

- 成果物は既定で `<project>/exports/<source-name>.mp4` に置く。既存名があれば連番を使う。
- 状態の正本は `<project>/.akari/render.json` とする。HTML レポートは可視化専用とする。
- 成功時だけ `<project>/.akari/render-tmp/` を削除する。失敗時は診断用に保持する。
- 字幕は `captions.json` から決定的な HTML へ生成し、他のオーバーレイと同じ経路で焼き込む。
- 字幕スタイルの preset は `presets/textstyle/` にあり、`akari-apply-textstyle.mjs` で `captions.json` へ適用できる。この実行体も同じ解決の対象で、`<render-cut>` と同じ `bin/` 配下にある。通常は edit-plan 段階で適用を済ませ、render-cut はその結果をそのまま描画する。
- verify PASS 後、CLI が `<project>/.akari/reports/contact-sheet.png` を自動生成する（判定材料の
  生成のみで合否判定はしない）。時刻列は plan（`predicted_duration_seconds` / `preset.fps` /
  cuts / overlays）だけから決定論で導出し、同一 edit.json + 同一素材なら時刻列・タイル画像とも
  バイト同一になる。時刻列は `render.json` の `contact_sheet.timestamps_seconds` に記録し、
  `render-report.html` から参照する。
- コンタクトシートで足りない区間を追加で視認するときの静止画も `<project>/.akari/reports/` へ置く。
  CLI 自身が使う `.akari/render-tmp/` とは別に、確認用の一時スクリプトや実験的な中間生成物を
  人が作る場合は `<project>/.akari/work/` へ置く
  （[project-structure-v0 契約](../../docs/contract-2026-07-25-project-structure-v0.md) §1）。
  いずれもプロジェクトルート直下には置かない。

## 公開契約

- [edit.json v0 と書き出し段構成](../../docs/contract-2026-07-13-m1-m4.md)
- [edit.json v1 拡張メモ](../../docs/notes-2026-07-13-edit-json-v1.md)
- [字幕とカット編集](../../docs/notes-2026-07-14-captions-and-cut-editing.md)
