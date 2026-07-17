---
name: manage-connections
description: AKARI Video の生成プロバイダ・SNS 接続・API キー参照・モデル選択・コスト承認ポリシーを一元管理する。初回セットアップ、接続状態の確認、provider やモデルの追加、有償生成・外部公開の実行前ゲートで発動し、`.akari/connections.json` と無償・読み取り専用の doctor を扱う。
---

# FORBIDDEN 級ハードルール

次の規則は詳細手順より常に優先する。

1. **キーの値を git 管理下ファイル・HTML・ログ・会話に出さない。** 表示は常にマスク
2. **credentials.env 以外からキーを探索しない。チャットでキーの提示を求めない。**
   置き場と KEY 名を案内し、人間が置く
3. **keychain / 外部 vault を必須依存にしない**（オプションバックエンドとしてのみ将来検討）
4. **doctor は無償・読み取り専用のみ。実生成テストはしない**（保留裁定 2026-07-17）
5. **有償操作は見積 → 明示承認まで実行しない**（edit-plan の Decision Communication
   Contract と同型）。予算上限の超過見込みで実行前に停止する
6. **リアルタイムフック監視（PreToolUse 等）を採用しない。** 状態は JSON、伝達は git 正味差分
7. **connections.json に無い接続を消費側スキルが使わない**（本スキルが唯一の入口。
   42・70 系の契約はこのルールを継承する）

# 実行順リーフ

1. プロジェクトの `.akari/connections.json` を読み、使う provider と
   `models.default / allowed`、`policy` を確認する。レジストリに無い接続や allowed 外のモデルを
   使わない。
2. 前回の `doctor` 結果を提示する。再確認を明示された場合だけ、プロジェクトルートで
   `node <このスキルのディレクトリ>/bin/doctor.mjs` を実行する。別プロジェクトを確認する場合は
   そのプロジェクトルート、または connections.json のパスを第 1 引数に渡す。
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

## 根拠

- 正本契約: internal `planning/contract-2026-07-17-manage-connections.md`
- first-run・代理取得しない規律: [../setup-library/SKILL.md](../setup-library/SKILL.md)
- 有償操作の承認ゲート: [../edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md)
- レジストリ検証: `node packages/schemas/bin/validate-connections.mjs .akari/connections.json`
