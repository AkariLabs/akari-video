---
name: compile-review-session
description: 録音 review セッションの audio.wav・events.jsonl・edit.snapshot.json・session.json を、analyze-footage と同じ 3 層 STT で文字起こしし、発話区切り・軌跡からの参照解決・命令形への正規化を経て review.json の open annotation とコンパイルレポートへ着地する。喋りながら行った QA セッションをチケット化するとき、recorded / transcribed セッションをコンパイルするとき、または compiled セッションを明示的に再コンパイルするときに使う。
---

# review セッションをコンパイルする

## ハードルール

1. `audio.wav`、`events.jsonl`、`strokes.json`、`edit.snapshot.json` を変更しない。
2. snapshot がなければ拒否する。現在の edit.json や recT から sourceT を推測しない。
3. STT は `analyze-footage` の 3 層に相乗りし、独自 provider 設定を作らない。word 時刻のない
   結果を採用せず、クラウドへは決定カードと明示承認なしに送信しない。
4. 曖昧な発話を黙って捨てたり参照先を断定したりしない。`[要確認]` + low confidence へ倒す。
5. review.json は既存 annotation のバイト列を変えず原子的に追記する。上書き・削除・ID 再利用を
   しない。
6. compiled セッションは既定でスキップする。`--force` でも古い annotation と
   compiledAnnotations を保持して新 ID を足す。
7. 1 セッションの破損で全体を止めない。manifest 破損は skip、snapshot 欠落は reject として
   レポートし、他を続ける。

## 実行順

1. [compilation-rules.md](compilation-rules.md) を読み、時計、STT、発話区切り、参照解決、着地、
   劣化の規則を確認する。
2. プロジェクトの `review/sessions/` と `review.json` を読み、対象と既存最大 annotation ID を
   確認する。
3. 実案件では判断用の提案を先に作る。

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> \
     --session <s-XXXX> --prepare-only --json
   ```

4. `compile-proposals.json` の原文、recRange、参照候補、暫定採否・正規化を音声・events・snapshot
   と照合する。各 `decision` に `action: "annotate" | "discard"`、`reason`、annotation の
   命令形 `text`、`confidence: "high" | "low"` を記入する。参照を変える必要があれば根拠を
   確認して `reference` を修正する。曖昧なら discard せず low にする。
5. 判断済み提案を着地する。

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> \
     --session <s-XXXX> --apply-proposals --json
   ```

   compiled の再コンパイルを prepare/apply する場合は両方のコマンドへ `--force` を付ける。

6. 自動一括が明示された場合だけ提案の暫定判定を直接適用する。

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> --json
   ```

7. CLI 結果と各 `compile-report.md` を読み、発話 N、着地 M、要確認 K、破棄内容と理由、backend、
   warning を報告する。review.json の既存行、session 原本 4 点、スキップ対象が不変であることを
   確認する。

## オプション

- `--session s-XXXX`: 1 セッションだけを処理する。
- `--force`: compiled も再コンパイルし、新規 ID を追加する。
- `--allow-cloud-stt`: doctor ok のクラウド候補を decision card まで評価する。送信にはさらに
  `--cloud-provider scribe|groq --cloud-approved` が必要。
- `--json`: 機械可読な集計を stdout に出す。

## 出力

- `review/sessions/s-XXXX/transcript.json`: backend provenance と word 時刻付き segments。
- `review/sessions/s-XXXX/compile-proposals.json`: prepare 時の判断面。
- `review/sessions/s-XXXX/compile-report.md`: 発話→着地、要確認、破棄、劣化、役割分担。
- `review.json`: v0 annotation への追記。
- `review/sessions/s-XXXX/session.json`: status と compiledAnnotations の追記的更新。

既知の同期差として、`packages/schemas/review.schema.json` の `input` enum と現行
`apps/shell` reader はまだ `"session"` を許可していない。enum / UI reader の拡張は別タスク
（本スキルの境界外）であり、本スキルは accepted 契約どおり `input: "session"` を書く。
