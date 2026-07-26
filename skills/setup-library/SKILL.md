---
name: setup-library
description: AKARI Video を初めてセットアップするとき、または現在のプロジェクトに使える素材が足りず新しく揃えたいときに発動する。ffmpeg / whisper-cli / headless Chrome の道具チェック、catalog/ を読んだスターターパック提案、人間の明示承認、取得・配置・検証・INDEX 更新までを一気通貫で行う first-run スキル。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次のいずれかに違反する形で素材セットアップを進めない。詳細リーフより常に優先する。

1. **人間の明示承認なしに取得・購入・ログインを実行しない。** 承認前に catalog エントリを `assets/` へ書き込まない。
2. **在庫を捏造しない。** `catalog/` に存在しないカテゴリ・エントリ・URL・ライセンス表記を提案・記録しない。カタログが空、または該当カテゴリが未整備なら「提案できる素材がない」と正直に報告する。
3. **license が確定しない素材を `assets/` へ入れない。** `source.license_at_source` を鵜呑みにせず、確認できた範囲だけを書く。確定できなければ配置を止める。
4. **`acquisition: login` / `purchase` はエージェントが代理取得しない。** URL を提示してユーザー自身に取得させ、置き場所を確認してから次工程へ進む。
5. **`assets/` 配置後に `remote` フラグを残さない。** 実体が揃っていないのに `assets/` 側で「配置完了」と報告しない。
6. **`attribution_required` が true の素材は記録を省略しない。** `assets/<category>/INDEX.md` への明記と、プロジェクト側クレジットが必要になる旨のユーザーへの明示を必須とする。
7. **`node packages/schemas/bin/validate-asset.mjs` を通さずに「検証済み」と報告しない。**
8. **既存の `assets/<category>/<id>/` を無断で上書きしない。** id が衝突したら内容を比較し、人間の判断を仰ぐ。

# 実行順リーフ

1. [tools-check.md](tools-check.md) — ffmpeg / whisper-cli / headless Chrome の実在確認
2. [starter-pack.md](starter-pack.md) — `catalog/INDEX.md` を読み、用途を聞き、スターターパックを提案して承認を得る
3. [fetch-and-validate.md](fetch-and-validate.md) — 承認された素材だけを取得し、`assets/` へ配置、検証、`INDEX.md` 更新

詳細を先読みせず、現在の工程に対応するファイルだけを読む。承認が得られていない工程を先に進めない。

## 根拠

- 契約: [`docs/contract-2026-07-13-asset-library.md`](../../docs/contract-2026-07-13-asset-library.md)「カタログと取得スキル」§
- 素材化・meta.json v0 の詳細規律: [../harvest-asset/SKILL.md](../harvest-asset/SKILL.md)
- authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
