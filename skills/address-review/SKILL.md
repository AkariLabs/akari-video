---
name: address-review
description: review.json の open チケット（annotation）を edit.json への実対応 → edit-lint → チケット更新まで型どおりに執行するスキル。「a-0002 と a-0003 に対応して」「open チケット全部に対応して」で発動する。状態機械（open → addressed + response 必須・resolved 不可侵・黙殺禁止）を bin/respond.mjs が原子的に守る QA ループの消費側。
---

# open チケットへ対応する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

正典: internal `planning/contract-2026-07-15-review-annotations.md` §1/§3/§5（状態機械）+
`planning/contract-2026-07-24-review-session.md` §6（session 由来の増補フィールド）。

## ハードルール

1. **状態機械を厳密に守る**: `open → addressed` は必ず `response`（`summary` + `action` +
   `respondedAt`）を伴う。`resolved` には**絶対に書き込まない**（人間専用の承認ゲート）。
   `addressed` からの再対応もしない。これらは `bin/respond.mjs` がプログラムとして拒否する
   （ガードを迂回して review.json を手で書き換えない）。
2. **黙殺しない**: 対応しない/できないと判断したチケットも必ず `declined` + 理由を `summary`
   に書いて `respond` する。判断に迷う場合も、open のまま放置せず `declined` + 質問を
   summary に書く。
3. **`[要確認]` は明示指名されたときのみ対象**: `text` が `[要確認]` で始まる annotation は
   `--all-open` では対象外（`bin/list.mjs` が自動でスキップし、スキップした旨を出力する）。
   `--ids` で当該 id を明示したときだけ対象にする。`[要確認]` はオーナーへの質問であり、
   エージェントが勝手に解釈して消化してよいものではない。
4. **edit.json への実装は edit-lint を通してから respond する**: 字幕系の指示は captions 規約
   （[字幕とカット編集](../../docs/notes-2026-07-14-captions-and-cut-editing.md) — 隙間の原則・
   実発話区間・最短 1.0s）に従う。`node packages/edit-lint/bin/edit-lint.mjs <project> --media`
   が PASS してから `respond` を打つ（PASS 前に addressed にしない）。
5. **判断（編集内容の解釈・実装）はエージェントが行い、bin は機械可能な部分（列挙・状態遷移の
   執行）だけを担う**。bin に「どう直すか」の判断をさせない。

## 実行順

1. 対象を列挙する。

   ```sh
   node skills/address-review/bin/list.mjs <project-root> --ids a-0002,a-0003
   node skills/address-review/bin/list.mjs <project-root> --all-open
   ```

   出力には `sourceT` / `sourceRange` / `target`（`cut:<index>` 等）/ `text` / `input` に加え、
   session 由来（§6 増補）なら `session`（id・recRange・confidence）と `strokes`（sessionRef 付き）
   を人間可読に整形して表示する。`--all-open` は `[要確認]` annotation を自動でスキップし、
   スキップした id と件数を出力に含める。
2. 各チケットについて `text` の指示（source 秒・target が入っている）を読み、対応方針を決める。
   - 対応する場合: edit.json（必要なら captions.json）を編集し、
     `node packages/edit-lint/bin/edit-lint.mjs <project-root> --media` を PASS させる。
   - 対応しない場合: 理由を明確にする（黙殺しない）。
3. 判断が確定したチケットごとに状態を執行する。

   ```sh
   node skills/address-review/bin/respond.mjs <project-root> \
     --id a-0002 --action edited --summary "captions.json に c-0009〜c-0013 を追加。edit-lint --media PASS 確認済み。"

   node skills/address-review/bin/respond.mjs <project-root> \
     --id a-0003 --action declined --summary "参照素材が assets/ に無いため見送り。素材が揃ったら再度チケットを切ってください。"
   ```

   `respond` は対象が `open` でなければ（`resolved` / `addressed` / 未知 id いずれも）拒否し、
   `summary` が空でも拒否する。いずれの拒否も review.json を一切変更しない
   （exit code: 成功 0 / ガード拒否 1 / 入力・実行環境エラー 2）。
4. 全 respond 後に対応サマリを 1 枚報告する: 対応 id ごとの action（edited/declined）・
   summary の要旨、スキップした `[要確認]` id、拒否があればその理由。

## オプション

- `list.mjs --ids <id,id,...>`: 指定 id だけを列挙する（`[要確認]` も対象に含まれる）。
- `list.mjs --all-open`: `status: "open"` すべてを列挙し、`[要確認]` はスキップして報告する。
- `list.mjs --json` / `respond.mjs --json`: 機械可読な出力を stdout に出す。
- `respond.mjs --id --action edited|declined --summary "..."`: 状態遷移の実行器。
  `respondedAt` は実行時刻から自動生成する（ISO8601、上書き不可）。

## 出力

- `bin/list.mjs`: 対象チケットの一覧（人間可読 or `--json`）。ファイルへの書き込みはしない。
- `bin/respond.mjs`: `review.json` への原子的な状態遷移（`open → addressed` + `response`）。
  対象以外の annotation・対象の他フィールドはバイト単位で不変。

## 実プロジェクトへの適用について

本スキル自体は open チケットへの対応を型どおりに実行する道具である。どの edit.json の変更が
「対応」に当たるかの判断（字幕の正確な範囲、削るべきカット等）はプロジェクトごとに一次情報
（音声・映像・transcript）を確認して行うエージェントの仕事であり、bin が代行しない。
