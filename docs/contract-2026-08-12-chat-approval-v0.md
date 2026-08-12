# chat-approval 契約 v0（チャット通知 + ボタン承認）

- 日付: 2026-08-12
- 状態: **v0 ドラフト・要オーナーレビュー**
- 前提: `contract-2026-08-02-setup-remote-v0.md`（tailnet 限定の閲覧経路。レポート URL の供給元）、
  `contract-2026-07-25-project-structure-v0.md`（承認レポートの実体）、
  `packages/decision-cards/report-helper.mjs`（`decisions.json` の read / write / commit の唯一の実装）、
  `skills/manage-connections`（接続レジストリと credentials の唯一の入口）
- スコープ: 承認ゲート到達を**チャットへ通知**し、**ボタンのタップだけで**承認を返せるようにする
- 非スコープ: チャットからの自由文指示、エージェントの起動・操作、素材のチャット搬送、
  複数チャネル対応（v0 は Telegram 1 本）

## 0. 位置づけ — 一言で言い切る

**チャットは配管であって頭脳ではない。** 運ぶのは「できました」という通知・レポートへのリンク・
画像・そして**列挙可能な承認の返事**だけ。編集の判断は従来どおり AKARI のパイプラインが持ち、
承認の記録は `decisions.json` が持つ。チャット層は SSOT を一切持たない。

## 1. 決定事項

| 論点 | 決定 |
|---|---|
| 何を足すか | **通知と承認だけ**。エージェントをチャットから起動しない（別契約） |
| 書き込み経路 | ブリッジは `decisions.json` を**自分で書かない**。report-helper の HTTP API（`POST /api/state` / `POST /api/commit`）を 127.0.0.1 経由で叩く。書き込みの原子性・検証・`0600`・二重確定の 409 は既存実装のまま効く |
| 受信方式 | **long polling**（`getUpdates`）。公開エンドポイント・webhook・トンネルを作らない（受信口をインターネットに開けない） |
| 入力語彙 | **閉じた語彙のみ**。`callback_data` が既定の集合に一致するものだけ処理し、自由文は処理しない |
| チャネル | Telegram のみ（v0）。実装は `packages/chat-bridge/` に置き、後で LINE / Discord を足せる形にする |

## 2. なぜ自由文を入れないか（この契約の中心）

自由文をエージェントへ通すと、`planning`（非公開）の信頼境界契約が扱う prompt injection の
窓口がそのまま開く。ボタンの `callback_data` は**発行側が定義した有限集合**であり、
受信側は集合に無い値を捨てるだけでよい。v0 はこの性質を設計の土台にする。

- 差し戻しは「確定しない + レポートを開くリンクを返す」で表現する。理由の自由記述はレポート側で行う
- 自由文メッセージを受けたら、処理せず「レポートで操作してください」と定型文を返す

## 3. 安全規律（ハードルール）

1. **トークンを git 管理下・レポート・ログ・会話に出さない。** 置き場は
   `~/.config/akari-video/credentials.env`（`600`）のみ。エージェントは値を読まず、KEY 名だけ案内する
2. **チャット ID の許可リストを必須にする。** 登録済み chat ID 以外からの update は
   一切処理せず破棄する（bot のユーザー名は誰でも到達できるため、これが無いと第三者が承認できる）
3. **ブリッジはポートを listen しない。** 送信も受信も outbound の long polling のみ
4. **`decisions.json` を直接書かない**（§1 の決定）。report-helper 経由のみ
5. **update の重複処理をしない。** `update_id` で冪等化する（Telegram は再配信しうる）
6. **送ってよいのはレポートの画像とテキストのみ。** 撮影素材の原本・secrets・パスの内部構造を送らない
7. **疎通確認（実機への通知到達 + ボタンで `decisions.json` 更新）が取れるまで完了と言わない**

## 4. 構成要素

| 要素 | 置き場 | 役割 |
|---|---|---|
| ブリッジ本体 | `packages/chat-bridge/telegram.mjs` | 通知送信 + long polling + report-helper API 呼び出し |
| セットアップスキル | `skills/setup-chat-approval/` | doctor → BotFather 案内（人間手番）→ chat ID 取得 → 疎通確認。`setup-remote` と同じ型 |
| 接続登録 | `.akari/connections.json` | `manage-connections` の管轄（§5 の判断待ち） |

### 送るメッセージの形

```
🎬 <プロジェクト名> — 承認をお願いします
<要約 1〜2 行>
[キーフレーム画像 数枚]

[ レポートを開く (URL) ] [ おまかせで確定 ] [ あとで ]
```

- 「レポートを開く」は URL ボタン（tailnet 限定 URL。Telegram のサーバーからは到達できないため
  リンクプレビューは出ない → `disable_web_page_preview` を付ける）
- 「おまかせで確定」は全カード既定値のまま `POST /api/commit`（レポート側の `accept-all` と同義）
- v1 の拡張余地: カードごとに選択肢ボタンを展開する（`data-option` は有限集合なので §2 と両立する）

## 5. 判断待ち — `connections.json` の `kind` 拡張

現行スキーマの `kind` は `genai / image / video / tts / music / sns / analytics` の閉じた enum で、
**通知系の枠が無い**。`manage-connections` のハードルール 7（レジストリに無い接続を使わない）を
守るには、いずれかを選ぶ必要がある:

| 案 | 内容 | 評価 |
|---|---|---|
| **A. `notify` を enum に追加** | スキーマ + 検証 + 例 + `apps/shell` 側ミラーを更新 | **推奨**。通知は既存のどの kind とも性質が違う（発信ではなく往復）。将来の LINE / Discord も同じ枠に入る |
| B. 既存の `sns` を流用 | 変更ゼロ | `sns` は「SNS へ投稿する」枠であり、承認の往復とは別物。意味が濁る |
| C. レジストリに載せない | credentials.env だけで完結 | ハードルール 7 違反。採らない |

## 6. 成果物と受け入れ基準

- **L0**: スキル lint / スキーマ検証 / 既存テストが green
- **L1**: 決定論の単体テスト — 許可外 chat ID の破棄・未知の `callback_data` の破棄・
  `update_id` の冪等化・自由文の非処理・トークンが出力に混じらないこと
- **L2**: 実機 — スマホへ通知が届き、ボタンのタップで `decisions.json` が更新される

## 7. 将来（非スコープの明示）

- カードごとの選択肢ボタン展開（v1）
- 複数チャネル（LINE / Discord / Slack）
- チャットからのエージェント起動・自由文指示（信頼境界の別契約が前提。常駐エージェント
  = Hermes 等の検討もここに属する）
- 承認待ちのエージェント側の再開機構（現状は人間が「続けて」と言う前提。ファイル待ちの
  ポーリングを挟む設計は別途）
