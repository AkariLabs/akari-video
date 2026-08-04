---
name: setup-audio-library
description: BGM・効果音の音源ライブラリを増やしたいときに発動する。既定は自社ライブラリ AKARI Sounds の一括取得（GitHub Release から直接ダウンロード。BGM・ジングルはこれで全量揃う）。AKARI Sounds に無い系統（拍手・失敗音・和風打撃）だけ、フリー配布元の候補リスト HTML + ドロップフォルダ照合/取得代行で補完する。試聴ギャラリーで keep/drop するまでの半自動セットアップ。setup-library / harvest-asset の姉妹スキル（音源だけ流儀が異なるため独立）。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次のいずれかに違反する形で音源セットアップを進めない。詳細リーフより常に優先する。

> **適用範囲**: ルール 1・2 の取得規律は**第三者配布元**（効果音ラボ・DOVA-SYNDROME 等、
> candidates.json の `categories` に載る外部サイト）を守るためのもの。自社（first-party）の
> AKARI Sounds（candidates.json の `first_party`。**既定ソース**）は自社 GitHub Release が
> 配布主体のため一括取得してよい（2026-08-03 オーナー裁定。動作は
> [first-party.md](first-party.md)。取得先を AkariLabs/akari-sounds 以外へ広げない）。
> ルール 3〜8 は first-party にも同様に適用する。

1. **エージェントによる取得はユーザーの指示で行う（第三者配布元）。** 第三者分の既定フローは
   「候補リスト HTML を生成する」「ドロップフォルダを走査する」であり、ユーザーが取得を
   指示したときだけ配布元から直接取得する（取得する/しないの判断はユーザーに委ねる。
   配布元ごとの可否をこちらで先回りして断定・列挙しない）。取得を実行するときの動作は
   [assisted-fetch.md](assisted-fetch.md) に従う:
   - 取得できるかは実行時にその場で確認する。取得できなかった配布元は理由を添えて
     そのまま報告し、ダウンロードページへのリンクを案内して手動に切り替える
   - 直列取得・リクエスト間 3〜5 秒スリープ・失敗はリトライ 1 回まで。一括・並列取得はしない
   - ページから実際に読み取れたファイル URL のみ取得する。**当て推量で URL を組み立てて
     取得しない**
   - 取得元ページ URL・取得日時・ライセンス・クレジット要否を来歴として記録する
     （`~/.akari/assets/audio/_staging/<site>/<id>/` の評価用ステージングに
     `.meta.json` を添える）
   - 評価後、keep 以外は破棄する（取得は「まとめて試聴して選ぶ」ための一時ステージング）
2. **候補リストのリンクは必ずダウンロードページ URL にする。** 音声ファイルへの直リンクは
   張らない。
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
8. **配布元に公式説明があるなら原文をそのまま記録する。推測で意味付けを起草しない。**
   出典特定（ファイル名・md5・規約）と意味付け（何の音か・いつ使うか）は別工程であり、
   ファイル名の実在確認だけで説明文を創作してはならない（2026-07-31 オーナー裁定。
   前例: チーン1 を「終了/決定」と推測起草したが、配布元の公式説明は
   「がっかりした時の演出に」で真逆だった）。公式説明が無い場合はその旨を記録した上で
   推測である旨を明示する

# 実行順リーフ

1. [first-party.md](first-party.md) — **既定**: 自社ライブラリ AKARI Sounds を GitHub Release
   から一括取得し user スコープへ登録する（BGM・ジングルはこれで全量。初回セットアップは
   まずこれ）
2. [candidate-list.md](candidate-list.md) — AKARI Sounds に無い系統の補完: `catalog/audio/candidates.json` を元に候補リスト
   HTML を生成する。既所有（catalog 登録済み）はグレーアウト表示になる
3. [drop-folder.md](drop-folder.md) — ユーザーがドロップフォルダへ保存したファイルを走査し、
   候補と照合してライブラリ配置 + catalog メタ登録、または隔離する（第三者分の既定フロー）
4. [assisted-fetch.md](assisted-fetch.md) — ユーザーの指示があるときだけ: エージェントが
   取得を代行し、来歴付きで `_staging/` に置く
5. [gallery.md](gallery.md) — 登録済み音源を試聴し、keep/drop を記録する
6. [store-unlock.md](store-unlock.md) — AKARI Store で購入した宣言パックの導入
   （`akari store status` → `install` → 検証。「購入した素材をセットアップして」で発動）

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
