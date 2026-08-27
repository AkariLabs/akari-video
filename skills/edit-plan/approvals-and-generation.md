# 承認と生成の統治

## 原則

生成の速さより、何を、どの手で、なぜ行ったかを人間が先に理解できることを優先する。推奨は示すが、複数案を黙って既定選択しない。

## Decision Communication Contract

有償または重い生成の前に、会話上で次を宣言する。

```text
対象:
使う手:
理由:
代替案と得失:
費用・待ち時間・外部送信などの影響:
実行後に残す provenance:
```

選択が人間の意図や費用を変える場合は、宣言だけで実行せず回答を待つ。契約ですでに静止画の作成が承認されている場合も、手と理由は宣言して `decision-log.md` に追記する。失敗時に別の手へ切り替える前も、変更理由と得失を追記する。

## 手の優先順と禁止事項

1. Codex の画像生成を使い、プロジェクトへ画像ファイルを保存する。
2. Codex で実行不能または不適合なら、理由を示して Akari Cloud API / MCP をエージェント層から使う。
3. どちらも使えない、品質や権利を満たさない場合は、経路 A の実フレームを使うか、素材を `使わない` とする。

OpenAI、Gemini 等の API キーを直接使わない。キーの提示を求めず、`.env` から探索せず、アプリ本体へ生成通信を実装しない。優先順は黙って fallback する許可ではない。

### 手 1（Codex 画像生成）の実働確認

**実測済み（2026-07-14）**。`codex-cli 0.144.1`（ChatGPT 認証）で画像ファイルの実生成まで確認した。

- 呼び出し形: 作業ディレクトリへ `cd` してから `codex exec --skip-git-repo-check "<プロンプト>"` をフォアグラウンドで実行する。バックグラウンド起動は即時リターンして生成を待たない既知問題があるため避ける。macOS 標準には `timeout` / `gtimeout` がなく、呼び出し元ツール側のタイムアウトで代替する（目安 600 秒）。
- 事前確認: `codex features list` で `image_generation` は `stable / true`。`codex doctor` で ChatGPT 認証・websocket 接続が正常であること。
- 実測結果: プロンプト「16:9 の動画サムネイル用の背景画像を生成。ダークトーン、テック系、抽象グラデーションと光の筋、文字なし。bg-test.png として保存」に対し、**93 秒**で 1664×936（16:9）の PNG 1.7MB が指定ディレクトリに書き出された。視認確認で指示どおりの内容（文字・ロゴ・UI なし）。プロンプトの日本語指示・保存ファイル名指定・アスペクト比指定はいずれも守られた。
- 既知の失敗モード: ChatGPT アカウントの使用量上限に達していると、画像生成に限らず全ターンが即時 `usage limit` エラーで失敗する（上限リセット待ちまたはプラン変更で回復）。エラー文中に回復予定時刻が出るので完了報告に記録する。
- 生成後は provenance（手 = codex exec / model or tool version・prompt・ISO 8601 日時）を必ず記録する。

## provenance

生成物ごとに、チャットでの提示内容と `decision-log.md` から次を辿れるようにする。

- asset ID と種別
- 使用した手と、分かる場合は model / tool version
- prompt と参照素材
- ISO 8601 の生成日時
- 出力ファイルとチャットで提示した preview
- fallback、加工、i2v など後続工程
- 対応する承認記録

実フレーム由来なら、生成 prompt の代わりに source、source 時刻、抽出手段を記す。混成案は背景生成と HTML 文字組を別工程として記録する。

## 3 段階チェックポイント

契約上の checkpoint 数 `3` は M5 の確定値であり不変。**2026-07-22 改訂**: Checkpoint 1（方針）の
回答チャネルだった決定カード（`<レポートパス>.decisions.json` + ヘルパー）は、edit-plan 自身の
レポート生成が analyze-project へ移管されたことに伴い廃止した。Checkpoint 1〜3 のすべてが
**チャットでの明示承認**に一本化される（正式なレポートは analyze-project の分析レポートのみ、
方向性の引き出しはチャットで行うという原則）。各 Checkpoint で `decision-log.md` へ追記した直後に
判断記録レポートを再描画し、パスを提示する（[report-guide §decision_log](report-guide.md#decision_log)）。

### Checkpoint 1: 方針

[analyze-project](../analyze-project/SKILL.md) の分析レポートを根拠として、サムネイル案、
編集方針、カット案をチャットで提示し、選択肢の得失を説明する（推奨案 + 代替案 + 理由。
「どうしますか」と丸投げしない）。人間から今回の方針に対する明示回答を得たら
`decision-log.md` に追記し、修正指示があればチャットで再提示する。承認前は素材計画を確定しない。

**編集実行ゲート**: チャットで明示承認を得るまで、編集実行（素材計画の確定・[execution.md](execution.md)）に進まない。無操作・タイムアウト・過去の包括承認を今回の承認に読み替えない。

### Checkpoint 2: 素材計画

承認済み方針に沿って、BGM とシーン単位素材の三択、静止 preview、provenance を提示する。ここで停止して明示回答を待つ。対応静止画が承認されていない i2v、アバター、動画 B ロールを実行しない。

### Checkpoint 3: 実行

次を manifest として提示する。

- 出力 width / height / fps
- source と keep range
- 複数素材の扱い（v2 の `sources[]` + media item か、単一中間マスターへの conform か）
- 実行する生成、conform、音声・B ロール焼き込み
- 作る overlay とタイミング
- 作るファイルと既存ファイルへの影響

人間が manifest を明示承認した後だけ [execution.md](execution.md) へ進む。素材計画の承認を実行承認と兼用しない。

承認済み画像を i2v へ進めるには、対応画像の承認、素材計画の承認、実行 manifest の承認をすべて確認する。契約上の checkpoint 数 `3` は M5 の確定値であり、無操作タイムアウトで減らさない。

## plan-comments.json による差し戻し受領

Checkpoint 2 / Checkpoint 3 の再提示に着手する前に、`<plan-dir>/plan-comments.json` の有無を確認する（**チャット返信の解釈より先に本ファイルを読む**）。`research-plan/storyboard.md` の `structure-confirm` と同型の規約であり、正本は [contract-2026-07-25-plan-comments-v0.md](../../docs/contract-2026-07-25-plan-comments-v0.md)。

- `pass: "scaffold"` の `plan-comments.json` が在れば、Checkpoint 2（素材計画）向けの差し戻しとして扱い、`comments[].target_kind: "slot"`（`target_id` は `plan.json` の `slots[].id`）で名指しされた slot **だけ**を改訂する。
- `pass: "final"` の `plan-comments.json` が在れば、Checkpoint 3（実行）向けの差し戻しとして扱い、`comments[].target_kind: "cut"`（`target_id` は v2 item id）で名指しされたクリップ **だけ**を改訂する。
- どちらも、名指しされていない slot / cut は無変更のまま次の提示に進む。改訂が終わったら **`plan-comments.json` を削除**してから、更新後の内容を再提示する。
- ファイルが無い回は、従来どおりチャットの差し戻し指示のみを解釈する。

## よくある間違い

- Codex が優先手であることを理由に、生成前宣言を省く。
- 推奨案だけを見せ、代替案の利点と欠点を隠す。
- 画像承認だけで i2v を始める。
- 前回プロジェクトの承認を流用する。
- fallback 後の手と prompt を provenance に残さない。
- チャットでの明示承認を得ずに、無操作や沈黙を承認とみなして次工程へ進む。
