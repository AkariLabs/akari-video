---
name: setup-remote
description: スマホなど別デバイスから承認レポート・プレビューを閲覧し、撮影素材を作業場へ送れるようにする遠隔セットアップスキル。Tailscale の状態を doctor で判定し、導入・ログイン（人間手番）→ tailscale serve でプレビューサーバー（既定 4567）と承認レポートヘルパーを tailnet 限定 HTTPS 化 → Taildrop 受信先を作業場 inbox/ へ接続 → 別デバイスからの疎通確認までを一気通貫でガイドする。「スマホでレポートを見たい」「外から承認したい」「スマホから素材を送りたい」「遠隔セットアップして」で発動する。公開インターネットへの露出（funnel）は既定で扱わない。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次のいずれかに違反する形で遠隔セットアップを進めない。詳細リーフより常に優先する。

1. **`tailscale funnel`（公開インターネットへの露出）を実行・提案しない。** ユーザーが明示的に
   funnel を要求した場合のみ、「URL を知る誰でも到達できる」リスクを説明し、明示承認を得てから扱う。
   既定は常に tailnet 限定（私設ネットワーク内のみ）。
2. **serve してよいのは許可リストの 2 件だけ** — (a) プレビューサーバー（既定 4567）
   (b) decision-cards レポートヘルパー（`report-helper.mjs`。承認レポート配信 + `decisions.json`）。
   **ファイルシステム・他ポート・他アプリを serve しない。** 許可リストの拡張は契約改訂を要する
   （スキルの判断で足さない）。
3. **インストール・ログイン・スマホ側アプリ導入を代行しない。** 人間の手番として明示的に依頼し、
   完了を doctor（`bin/doctor.mjs`）の再実行で確認してから次工程へ進む。
4. **ネットワーク設定の変更（serve の on/off・受信先変更）は、実行するコマンドと効果・解除方法を
   事前提示し、承認を得てから実行する。**
5. **secrets・認証情報を作業場・プロジェクトに書かない。** Tailscale の認証は Tailscale アプリ側が
   管理する。スキルが記録してよいのは serve URL と受信経路だけ。
6. **doctor を通さずに「構成済み」と報告しない。** 疎通確認（別デバイスでの閲覧 + Taildrop 着弾）が
   両方取れるまで完了と言わない。

# 実行順リーフ

1. [doctor-and-install.md](doctor-and-install.md) — doctor 判定 → 状態別の導入・ログインガイド（macOS / Windows / スマホ）
2. [serve-preview.md](serve-preview.md) — プレビューサーバー起動 → `tailscale serve` 設定 → URL 確定 →（承認をスマホで回す場合）レポートヘルパーの serve
3. [taildrop-inbox.md](taildrop-inbox.md) — Taildrop 受信先の固定 → 作業場 `inbox/` へ接続 → 疎通確認 → 完了レポート

詳細を先読みせず、現在の工程に対応するファイルだけを読む。人間手番の完了を doctor で確認せずに先へ進めない。

## 根拠

- 契約: [`docs/contract-2026-08-02-setup-remote-v0.md`](../../docs/contract-2026-08-02-setup-remote-v0.md)
- 作業場・`inbox/`・secrets 分離の原則: [`docs/contract-2026-08-02-creator-root-v1.md`](../../docs/contract-2026-08-02-creator-root-v1.md)
- 承認レポートの実体（`.akari/reports/`）: [`docs/contract-2026-07-25-project-structure-v0.md`](../../docs/contract-2026-07-25-project-structure-v0.md)
