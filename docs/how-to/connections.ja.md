[English](./connections.md) | **日本語**

# 接続と API キー

外部サービス（クラウド文字起こし・TTS・生成系 API・SNS 連携）の接続は
`manage-connections` スキルが一元管理します。

## 原則

- **ローカル完結の範囲は接続なしで使える** — プロキシ生成・whisper.cpp 文字起こし・
  編集・lint・書き出しは外部接続不要
- **API キーはチャットに出さない** — キーの実体は
  `~/.config/akari-video/credentials.env`（プロジェクト外）に置き、
  connections レジストリは**参照**だけを持つ
- **作業場が既定、プロジェクトは上書き** — 既定レジストリは
  `<creator-root>/.akari/connections.json` に置きます。プロジェクトの
  `.akari/connections.json` は任意のオーバーレイで、作業場レジストリが無ければ
  AKARI Video は製品同梱の既定レジストリへフォールバックします
- **有償実行は承認ゲートを通る** — コスト承認ポリシーに従い、
  課金が発生する実行の前に必ず確認が入る

## 状態を確認する（doctor）

**頼み方**: 「接続状態を見せて」「doctor かけて」

読み取り専用の診断が走り、どのプロバイダが使える状態か・何が未設定かを
レポート（`connections-report.html`）で確認できます。キー値は表示されません。
doctor は各 provider の結果を由来レイヤー（project / workspace / 適切な default の書き戻し先）
だけへ書き戻すため、プロジェクト内のコピーが作業場設定から乖離することを防ぎます。

## キーを登録する

**頼み方**: 「◯◯の API キーを設定したい」

エージェントが `credentials.env` への記入手順を案内し、登録後に doctor で疎通を確認します。

## モデル・プロバイダを選ぶ

文字起こし・TTS などバックエンドが複数あるものは、`connections.json` の
モデル選択で既定を決められます。「文字起こしはローカル whisper を既定にして」のように
発話で変更できます。

## パートナーエージェント（アプリの接続ボタン）

デスクトップシェルの接続ボタンはパートナーカタログを開きます。カードは
エージェント CLI（PTY タブで動く）またはエディタ拡張 1 つに対応します。現在のカタログは
**CLI 8 種** — Claude Code・Codex・opencode・Command Code・Copilot・Cursor・Antigravity・
Grok Build — と Claude Code / Codex の拡張 2 種を同梱しています。Command Code は Node.js 22
以上が必要で、未導入時は公式の `npm install -g command-code` パッケージ経路をシェルが使います。
カタログはデータ駆動
（`partner-catalog.json`）でリリースごとに増えるため、この一覧はスナップショットです。
どのパートナーから接続しても、最終的に同じ `.akari/` 配下のファイル契約に収束します。

## コスト承認ポリシー

おまかせ度（intake.json の `autonomy`）とは独立に、**課金と外部送信**については
`connections.json` のポリシーが優先されます。full-auto で編集を任せていても、
有償生成の前には確認が入る、という構えです。

## 関連

- 最初のセットアップ → [Getting Started](../getting-started.ja.md)
- ナレーション生成の有償 / 無償 → [ナレーションを付ける](../guides/narration.ja.md)
