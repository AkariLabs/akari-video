## Summary / 概要

<!-- 分割 PR の場合はマージ順の依存も書く -->

- 課題 / Problem:
- 解決 / Solution:
- 変えたもの / What changed:
- 変えていないもの / What did NOT change:

## Test plan / テスト

- [ ] `node --test`（触ったパッケージ）
- 実行したコマンド / Commands run:
- 未検証と理由 / Not tested & why:

## Security impact / セキュリティ自己申告

<!-- 外部 PR は自動スクリーニングを通ります（詳細: CONTRIBUTING.md）。
     Yes = 拒否ではありません。下の申告欄に対象と理由を書けばレビューが速く進みます -->

- コード内に新しい外部ドメインへの URL・ネットワーク呼び出しを追加した？: No
- `curl … | sh` 形式のワンライナーを追加した？（案内文字列内も含む）: No
- 依存を追加・変更した？: No
- プロセス起動（child_process 等）を追加した？: No
- secrets・環境変数・ファイル IO の扱いを変えた？: No
- レンダー経路に触れた？（決定論・オフライン契約）: No
- `.github/` / CI 設定を変更した？: No

### Yes の申告欄（対象と理由）

<!-- 例: cursor.com — Cursor CLI の公式 docs への案内 URL（表示のみ） -->
