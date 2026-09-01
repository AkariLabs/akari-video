---
name: edit-lint
description: edit.json と任意の analysis.json / captions.json / メディアを決定的 CLI で検査し、PASS 後のフレーム視認とレポートまで QA を完了する。edit.json を書いた、または変更した直後、書き出し前、レビュー指摘を反映した後の再確認で使う。
---

# 編集結果を lint して QA を閉じる

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

1. **決定的であること**: 同一入力 → 同一出力。LLM 判断・乱数・現在時刻を判定に混ぜない
   （`checked_at` の記録は可・判定には使わない）
2. **外部 npm 依存ゼロ**。ffmpeg / ffprobe は**本体直叩き**（ラッパーライブラリ禁止）
3. **書き込みは `.akari/lint.json` と `.akari/reports/` のみ**。edit.json を自動修正しない
   （fix は人間/エージェントの編集として git diff に出す）
4. **ネットワーク禁止**（完全ローカル・headless-first 不変条件どおりアプリ不要）
5. **外部候補のコード転写禁止**（loudcheck 等は設計参考のみ。survey の転記条件に
   関わらず本 CLI は全量自作 — 依存ゼロ規律と同根）
6. **analysis.json / captions.json / `.akari/intake.json` 不在をエラーにしない**（skipped 報告。
   プロジェクトの成長段階に関わらず常に走れる）
7. **`--media` なしの既定実行はメディアをデコードしない**（起動・CI で常用できる速さを守る）
8. **視認に使うキーフレーム静止画・QA 生成物、ad-hoc な一時検証スクリプトはプロジェクトルート
   直下に書かない**。前者は `.akari/reports/`、後者は `.akari/work/` へ置く
   （[project-structure-v0 契約](../../docs/contract-2026-07-25-project-structure-v0.md) §1）
   `.akari/work/` では、使い捨てを `tmp/`、作り直せないものを `keep/` に分ける。

## 実行手順

### 実行体の解決

第一手として `akari doctor --json` を実行し、`edit_lint.path` を `<edit-lint>`、
`cli.node.exec_path` を node の実行体として使う。まだこれらのフィールドを出力しない版なら、
次の探索へ進む。

次の 3 形態を表の上から `ls` し、最初に存在した `<edit-lint>` を使う。

| 形態 | macOS | Windows |
|---|---|---|
| (a) デスクトップアプリ同梱 | `<App>/Contents/Resources/packages/edit-lint/bin/edit-lint.mjs`（`<App>` の既定は `/Applications/AKARI Video.app`） | `<install dir>\resources\packages\edit-lint\bin\edit-lint.mjs` |
| (b) `install.sh` 経路 | `~/.akari/app/packages/edit-lint/bin/edit-lint.mjs` | `%USERPROFILE%\.akari\app\packages\edit-lint\bin\edit-lint.mjs` |
| (c) モノレポ | `<repo>/packages/edit-lint/bin/edit-lint.mjs` | `<repo>\packages\edit-lint\bin\edit-lint.mjs` |

(a) のデスクトップアプリだけを使う利用者には `~/.akari/app` は存在しない。

node の解決順は `AKARI_NODE_BIN` → PATH の node（20 以上）→ 同梱 Electron を
`ELECTRON_RUN_AS_NODE=1` で node として使う、の順とする。以下の `node` はこの手順で解決した
実行体、`<edit-lint>` は上で解決した実行体パスを表す。

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
書き込みは該当行の Edit か edit-store のスクリプト API を使う。

1. edit.json を保存した直後に、次を実行する。

   ```sh
   node <edit-lint> <project-root|edit.json>
   ```

2. exit code と `<project>/.akari/lint.json` を確認する。`0` は PASS、`1` は FAIL、`2` は入力や実行環境のエラーを表す。
3. FAIL なら `findings[]` を上から読み、指摘された edit.json、参照ファイル、overlay HTML、captions.json を該当行の Edit か edit-store のスクリプト API で修正する。CLI に自動修正させない。
4. 同じコマンドを再実行し、error finding がなく `verdict: "pass"` になるまで繰り返す。analysis.json または captions.json が無い検査は `skipped[]` で確認する。
5. 書き出し前は、使う出口に合わせて `--engine gpu` または `--engine osr` を追加して再実行する。
   書き出し側が出口を自動選択する場合は `--engine auto` を使い、エンジン適合性も PASS させる。
6. PASS 後に、カット境界と overlay の開始・終了フレームを実際に視認する。機械検査の PASS を意味的な品質確認の代わりにしない。
7. `<project>/.akari/reports/edit-lint-report.html` とフレーム視認結果を編集レポートへ反映し、checkpoint 状態と provenance を実態に合わせて閉じる。

音声も確認するときだけ `--media` を追加する。無音区間と音量値は既定で warning になり、次の明示閾値を指定した検査だけが FAIL になり得る。

```sh
node <edit-lint> <project> --media
node <edit-lint> <project> --media --silence-error-seconds 2 --max-volume-error-db -0.1
```

機械向けの標準出力が必要なら `node <edit-lint> <project> --json` のように `--json` を追加する。
状態の正本は常に `.akari/lint.json` とし、HTML は可視化にだけ使う。

`.akari/intake.json`（進め方フォームの保存先。契約: `packages/schemas/intake.schema.json`）が存在すれば、schema 検証と整合検査（未知の task ID・`duration_s`/`keep_length` の同時指定・`status: submitted` なのに `submitted_at` 欠落 等）を合わせて行う。不正値は error（FAIL）、`status: "draft"`（進め方が未確定）は warning に留める。

## 非スコープと拡張候補

黒フレーム、フリーズ、ビート、シーン、フラッシュフレーム、ギャップ、重複クリップ、オフラインメディア、セーフゾーン、フレームレート不整合は将来候補であり、現在の PASS 条件へ推測で追加しない。

## 音楽グリッド検査（宣言があるときだけ）

`audio.bgm.path` に対応する宣言が見つかったときだけ、
`packages/audio-library-setup/shared/beat-grid.mjs` の `musicGrid` で timeline 秒のグリッドを作り、
`audio.sfx[].t` を照合する。宣言ファイルの解決順は `suggest-bgm` / `beat-grid`
と同じく、`--declarations` → 環境変数 `AKARI_SOUNDS_DECLARATIONS` →
`<ライブラリ>/declarations.json` である。

- `audio.sfx.music-grid`（warning）: kind を問わず真に最寄りのグリッド点との差が ±0.12 秒を
  超えると警告する。同距離の場合だけキメ > 小節頭 > 拍の順で優先する。拍に乗せない演出も
  正当なので error にはしない。
- `audio.sfx.music-grid-seam`（warning）: BGM が末尾から先頭へ戻るループ継ぎ目の ±0.3 秒以内で
  SE が発火すると警告する。

宣言が無い、`audio.bgm` が無い、`audio.sfx` が空、または BGM の実尺を ffprobe で取得できない
場合は検査を静かにスキップする。理由は `skipped[]` に残すが warning は出さない。宣言は任意であり、
media からビートを自動検出する機能とは別の検査である。

## 公開契約

edit.json の検査対象は次の公開契約が定めるフィールドである。契約に無いフィールドの検査を推測で
足さず、契約が定めた検査（構造・id 一意性・範囲・参照整合）は既に実装済みである。

- [edit.json v0](../../docs/contract-2026-07-13-m1-m4.md)
- [マルチソース `sources[]` / `cuts[].src`](../../docs/contract-2026-07-18-edit-json-v1-sources.md)
  — `version: 1` の必須形、`source` と `sources[]` の排他、`sources[].id` の一意性、`cuts[].src` の参照整合
- [ナレーション `audio.narration[]`](../../docs/contract-2026-07-20-edit-json-v1-narration.md)
  — id 形式と一意性、`t` の timeline 座標、`gain_db` 範囲、provenance と credit
- [見せ場マーカー `beats[]`](../../docs/contract-2026-07-22-edit-json-v1-beats.md)
  — id・`t`（source 秒）・`kind`・`strength`・`src` の参照整合（`src` は v1 のみ）
- [演出宣言 `direction`](../../docs/contract-2026-07-23-edit-json-v1-direction.md)
  — `preset` の必須と `intensity` の範囲、`overrides` の型
- [語レベル演出 `emphasis_words[]`](../../docs/contract-2026-07-23-edit-json-v1-emphasis-words.md)
  — id 形式と一意性、`t_end > t_start`（source 秒）、`src` の参照整合（`src` は v1 のみ）
- [字幕とカット編集](../../docs/notes-2026-07-14-captions-and-cut-editing.md)
- [QA lint の方向性](../../docs/notes-2026-07-16-qa-lint-and-transcript-ui.md)
- エンジンのフィールド単位の適合性は
  [`packages/schemas/engine-capabilities.json`](../../packages/schemas/engine-capabilities.json) を正本とし、
  `--engine gpu|osr|auto` が `ignored` / `partial` / 対応表の欠落を検査する
