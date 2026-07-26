---
name: setup-audio-library
description: BGM・効果音の音源ライブラリを増やしたいときに発動する。フリー配布元の候補リスト HTML を生成し、ユーザー自身が手動でダウンロードしたファイルをドロップフォルダから照合・登録し、試聴ギャラリーで keep/drop するまでの半自動セットアップを行う。setup-library / harvest-asset の姉妹スキル（音源だけ流儀が異なるため独立）。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次のいずれかに違反する形で音源セットアップを進めない。詳細リーフより常に優先する。

1. **AI による自動取得は、ユーザーの明示指示がある場合に限り、条件付きで許可する**
   （2026-07-22 オーナー裁定により改訂。旧ルール「AI は自動・一括ダウンロードしない」を
   置き換え）。既定はやはり「候補リスト HTML を生成する」「ドロップフォルダを走査する」
   だけであり、以下の全条件を満たさない限り `curl` 等で配布元から直接音声を取得しない:
   - **ユーザー本人が当該取得タスクを明示的に指示していること**（「候補を見て後で自分で
     ダウンロードする」という既定フローを AI が勝手に取得フローへ切り替えない）
   - **bot/自動収集を規約で明記禁止するサイト、および robots.txt で自動化ボット向けに
     アクセス制限を明示しているサイトへは一切アクセスしない。** `robots.txt` は毎回
     取得前に確認すること。ToS が自動化について沈黙している「候補一覧上の許可サイト」
     であっても、`robots.txt` が named bot（`ClaudeBot` 等 AI クローラ名を含む）に対して
     個別に `Disallow` を明記している場合は、一般 UA を騙って回避してはいけない
     （2026-07-22 の実地確認で、効果音ラボの `robots.txt` が `ClaudeBot` を含む主要 AI
     ボットに対し `Disallow: /*.mp3$` を明記していたことが判明。ToS 沈黙だけで
     「許可サイト」と判定してはいけない教訓として記録）
   - **直列取得・リクエスト間 3〜5 秒スリープ・通常ブラウザ相当 UA・失敗はリトライ 1 回
     まで。** 一括・並列取得はしない
   - **取得元ページ URL・取得日時・ライセンス・クレジット要否を来歴として必ず記録する**
     （`~/.akari/assets/audio/_staging/<site>/<id>/` 等の評価用ステージングに
     `.meta.json` を添える）
   - **評価後、keep 以外は破棄する。** 取得はあくまで「まとめて試聴して選ぶ」ための
     一時ステージングであり、無条件の永続保存ではない
   - ページからファイル URL を実際に読み取れた曲のみ取得する。**当て推量で URL を
     組み立てて取得しない**（本ルール自体は不変）
   - フォーム送信・Referer 付与など「実ブラウザが行う標準的な操作の忠実な再現」は
     許容されるが、認証回避・レート制限回避・robots.txt 迂回を目的にしたヘッダー偽装や
     UA 偽装は行わない
2. **候補リストのリンクは必ずダウンロードページ URL にする。** 音声ファイルへの直リンクは
   張らない（効果音ラボ・甘茶の音楽工房・H/MIX GALLERY 等の「直リンク禁止」規約対応）。
3. **在庫・実在を捏造しない。** `catalog/audio/candidates.json` に無いサイト・URL・
   ライセンス表記を発明しない。ページの実在やファイル名を確認できない場合は
   `confidence: "blocked_unverifiable"` 等、不確かである旨をそのまま記録する。
4. **`ai_training_allowed` を安全側に倒す。** 配布元の規約が AI 学習利用を明示的に許可して
   いない限り `false` にする（未許諾を許可とみなさない）。CC0 明記のみ `true`。
5. **音声実体を本リポにコミットしない。** 実ファイルは常にリポジトリ外
   （`~/.akari/assets/audio/<id>/` 等の user スコープ）へ置く。`catalog/audio/` には
   `remote: true` の参照メタしか置かない。
6. **既存の `catalog/audio/<id>/` を無断で上書きしない。** id が衝突したら書き込みをスキップし
   ログに残す（harvest-asset / setup-library と同じ規律）。
7. **`node packages/schemas/bin/validate-asset.mjs` を通さずに「登録完了」と報告しない。**
   （library scope の実体エントリのみ対象。`remote: true` のカタログ参照エントリは
   validator 側の設計で preview.png チェックが免除される）

# 実行順リーフ

1. [candidate-list.md](candidate-list.md) — `catalog/audio/candidates.json` を元に候補リスト
   HTML を生成する。既所有（catalog 登録済み）はグレーアウト表示になる
2. [drop-folder.md](drop-folder.md) — ユーザーがドロップフォルダへ保存したファイルを走査し、
   候補と照合してライブラリ配置 + catalog メタ登録、または隔離する
3. [gallery.md](gallery.md) — 登録済み音源を試聴し、keep/drop を記録する

詳細を先読みせず、現在の工程に対応するファイルだけを読む。

## setup-library / harvest-asset との関係（意図的に独立スキルにした理由）

このスキルは `../setup-library/` や `../harvest-asset/` の meta.json v0 契約・スコープ階層
（`local` / `shared` / `user` / `builtin`）・validator をそのまま流用する。**ただし取得フロー
そのものは別スキルとして独立させた**。理由:

- `setup-library` は「その場でカタログを提示 → 承認 → 直接取得 or ログイン誘導」という
  単一セッション完結のフローを前提にしている。音源は「候補リストを見て、後日ゆっくり
  ダウンロードして、気づいたときにまとめて登録する」という**非同期・複数セッション**の
  運用になり、フローの形が本質的に異なる（`starter-pack.md` / `fetch-and-validate.md`
  へ無理に追記すると分岐が増えすぎる）。
- ドロップフォルダ走査・ファイル名照合・隔離（出典不明リスト）・試聴ギャラリーは、
  他カテゴリ（3d/font/broll 等）には無い音源固有の機構。
- 既存 2 スキルのファイルは変更していない（`setup-library/SKILL.md` にこのスキルへの
  参照リンクを追加することは今回のタスク境界外のため見送った。ユーザー・オーナーが
  必要と判断すれば別途追加できる）。

## 根拠

- 内部リサーチ: `research/2026-07-22-free-sfx-bgm-sources.md`（内部リポ、配布元ごとの
  規約判定・自動化適性・52 候補の一次情報）
- 公開契約: [`docs/contract-2026-07-13-asset-library.md`](../../docs/contract-2026-07-13-asset-library.md)
  「カタログと取得スキル」§・「アセットのスコープ階層」§
- 同型の既存実装（node:http ヘルパー + 静的 HTML の流儀）:
  [`packages/decision-cards/`](../../packages/decision-cards/README.md)、
  [`packages/intake-form/`](../../packages/intake-form/README.md)
- ドロップフォルダによる半自動取得の先例:
  [`../generate-narration/voice-profile-setup.md`](../generate-narration/voice-profile-setup.md)
  （mtime ベースの拾いルール。本スキルはファイル名照合ベースだが「ユーザーに取得させ、
  後からエージェントが拾う」という設計思想は同じ）
