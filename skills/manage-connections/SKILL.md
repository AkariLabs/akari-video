---
name: manage-connections
description: AKARI Video の生成プロバイダ・SNS 接続・API キー参照・モデル選択・コスト承認ポリシーを一元管理する。初回セットアップ、接続状態の確認、provider やモデルの追加、有償生成・外部公開の実行前ゲートで発動し、`.akari/connections.json` と無償・読み取り専用の doctor を扱う。
---

# FORBIDDEN 級ハードルール

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

次の規則は詳細手順より常に優先する。

1. **キーの値を git 管理下ファイル・HTML・ログ・会話に出さない。** 表示は常にマスク
2. **credentials.env 以外からキーを探索しない。チャットでキーの提示を求めない。**
   置き場と KEY 名を案内し、人間が置く
3. **keychain / 外部 vault を必須依存にしない**（オプションバックエンドとしてのみ将来検討）
4. **doctor は無償・読み取り専用のみ。実生成テストはしない**（保留裁定 2026-07-17）
5. **有償操作は見積 → 明示承認まで実行しない**（edit-plan の Decision Communication
   Contract と同型）。予算上限の超過見込みで実行前に停止する
6. **リアルタイムフック監視（PreToolUse 等）を採用しない。** 状態は JSON、伝達は git 正味差分
7. **connections.json に無い接続を消費側スキルが使わない**（ここでいう connections.json は
   project → workspace → default の順で解決済みのレジストリ。本スキルが唯一の入口。
   42・70 系の契約はこのルールを継承する）

# 実行順リーフ

1. project `.akari/connections.json` → 作業場 `.akari/connections.json` → 製品同梱の既定、の順で
   解決し、使う provider と `models.default / allowed`、`policy` を確認する。解決結果は
   `node <このスキルのディレクトリ>/bin/resolve-connections.mjs [プロジェクトルート]` で確認できる。
   レジストリに無い接続や allowed 外のモデルを使わない。
2. 前回の `doctor` 結果を提示する。再確認を明示された場合だけ、プロジェクトルートで
   `node <このスキルのディレクトリ>/bin/doctor.mjs` を実行する。別プロジェクトを確認する場合は
   そのプロジェクトルート、または connections.json のパスを第 1 引数に渡す。プロジェクトルート
   で実行した結果は provider の由来レイヤー（project / workspace / default）に対応するファイルへ
   書き戻される。
3. `~/.config/akari-video/credentials.env` が無ければ、doctor が示す置き場・KEY 名・取得先 URL を
   人間へ案内して停止する。代理取得・代理書き込みをしない。テストで差し替える場合だけ
   `AKARI_CREDENTIALS_FILE` にファイルパスを指定する。
4. provider を追加する場合は、人間が credentials.env に `KEY=VALUE` を 1 行追加し、
   `.akari/connections.json` の `providers` に値を含まない entry を 1 件追加する。
   `auth: env-key` の `env` は `${KEY_NAME}` 形式にする。doctor に安全な adapter が無い provider は
   `unchecked` と正直に残す。
5. モデルを変更する場合は `models.allowed` を先に確定し、`models.default` はその中から選ぶ。
   タスク単位の上書きは次の承認ゲートで宣言する。
6. 有償操作の前に [承認ゲート](../edit-plan/approvals-and-generation.md) と同じ形式で対象、使う手、
   理由、代替案、見積費用、待ち時間、外部送信、provenance を提示する。明示承認が得られるまで
   実行せず、未設定の予算上限や超過見込みがあれば停止する。

doctor は connections.json の `doctor` ブロックを書き戻し、プロジェクトルートへ読み取り専用の
`connections-report.html` を生成する。レポートに表示する資格情報は「設定済み（マスク）」または
「未設定」の存在有無だけとし、HTTP 応答本文やキー値を表示しない。

## memory 接続の管理

`.akari/connections.json` の `memory` 配列は、生成プロバイダとは別種の接続（外部参照記憶。
[contract-2026-07-25-memory-connection-v0.md](../../docs/contract-2026-07-25-memory-connection-v0.md)
が正本）を宣言する。資格情報・課金は発生しない読み取り専用の接続であり、本スキルが
`providers` と同じレジストリファイルの中で一元管理する。

- **追加**: `memory` 配列へ `{ "name": "<kebab-case>", "root": "<ローカルパス>" }` を最小構成として
  1 件追加する。`entry`（省略時 `INDEX.md`）・`include`/`exclude`・`read_policy`（省略時
  `read-only`）は任意。`root` に秘密情報（API キー等）を書かない — 経路情報のみを持つ
- **削除**: `memory` 配列から該当エントリを取り除くだけ。対になる credentials.env の行は無い
  （`memory` は `auth`/`env` を持たない）
- **doctor での表示**: `memory` エントリは `providers` の疎通確認（HTTP 認証チェック等）とは
  別の軽い確認に限る。`root`（および `root`+`entry`）のパス実在チェックのみを行う、無償・
  読み取り専用の確認である。有償生成の doctor と同じ「無償・読み取り専用のみ」原則
  （FORBIDDEN 級ハードルール 4）を継承するが、**`memory` は `doctor` フィールドを持たない
  スキーマ設計**（永続化する認証状態が無いため）であり、v0 時点の `doctor.mjs` はこの
  パスチェックを実装しない（データ契約 + スキル規約の確立が v0 の範囲。実装は次段）
- `root` へ実際にアクセスできない場合も、読む瞬間（research-plan / edit-plan の冒頭・
  analyze-project の文脈読み合わせ）のスキル実行そのものは止めない（劣化規約は
  memory-connection-v0 契約 §5 を参照）

## 根拠

- 正本契約: 接続・設定管理契約（2026-07-17）— 非公開の内部記録（`akari-video-internal`）にある
- first-run・代理取得しない規律: [../setup-library/SKILL.md](../setup-library/SKILL.md)
- 有償操作の承認ゲート: [../edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md)
- レジストリ検証: `node packages/schemas/bin/validate-connections.mjs .akari/connections.json`
