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

## 実行手順

1. edit.json を保存した直後に、リポジトリルートから次を実行する。

   ```sh
   node packages/edit-lint/bin/edit-lint.mjs <project-root|edit.json>
   ```

2. exit code と `<project>/.akari/lint.json` を確認する。`0` は PASS、`1` は FAIL、`2` は入力や実行環境のエラーを表す。
3. FAIL なら `findings[]` を上から読み、指摘された edit.json、参照ファイル、overlay HTML、captions.json を手で修正する。CLI に自動修正させない。
4. 同じコマンドを再実行し、error finding がなく `verdict: "pass"` になるまで繰り返す。analysis.json または captions.json が無い検査は `skipped[]` で確認する。
5. PASS 後に、カット境界と overlay の開始・終了フレームを実際に視認する。機械検査の PASS を意味的な品質確認の代わりにしない。
6. `<project>/.akari/reports/edit-lint-report.html` とフレーム視認結果を編集レポートへ反映し、checkpoint 状態と provenance を実態に合わせて閉じる。

音声も確認するときだけ `--media` を追加する。無音区間と音量値は既定で warning になり、次の明示閾値を指定した検査だけが FAIL になり得る。

```sh
node packages/edit-lint/bin/edit-lint.mjs <project> --media
node packages/edit-lint/bin/edit-lint.mjs <project> --media --silence-error-seconds 2 --max-volume-error-db -0.1
```

機械向けの標準出力が必要なら `--json` を追加する。状態の正本は常に `.akari/lint.json` とし、HTML は可視化にだけ使う。

`.akari/intake.json`（進め方フォームの保存先。契約: `packages/schemas/intake.schema.json`）が存在すれば、schema 検証と整合検査（未知の task ID・`duration_s`/`keep_length` の同時指定・`status: submitted` なのに `submitted_at` 欠落 等）を合わせて行う。不正値は error（FAIL）、`status: "draft"`（進め方が未確定）は warning に留める。

## 非スコープと拡張候補

黒フレーム、フリーズ、ビート、シーン、フラッシュフレーム、ギャップ、重複クリップ、オフラインメディア、セーフゾーン、フレームレート不整合は将来候補であり、現在の PASS 条件へ推測で追加しない。

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
