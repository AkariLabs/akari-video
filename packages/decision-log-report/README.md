# @akari-video/decision-log-report

`decision-log.md` から読み取り専用の判断記録レポートを派生描画する、外部 npm 依存ゼロの CLI
です（Node.js 組み込みモジュールのみ）。契約・タスク定義は内部リポで管理します。

## 構成

| ファイル | 役割 |
|---|---|
| `template.html` | データを含まない UI 正本。固定 6 節と安全な DOM 描画を担う |
| `render-decision-log-report.mjs` | ログを寛容に読み、画像を検証し、JSON データをテンプレートへ埋め込む CLI |
| `test/` | 匿名 fixture と `node:test` による 8 観点の回帰テスト |

## 使い方

```sh
node packages/decision-log-report/render-decision-log-report.mjs \
  --log <project>/decision-log.md \
  --out <project>/.akari/reports/decision-log-report.html \
  [--project <project>]
```

`--log` と `--out` は必須です。`--project` を省略すると `--log` の親を使いますが、ログの親が
`planning` の場合はその親を project root とみなします。出力先の親ディレクトリは自動作成します。
読めない入力や書けない出力では exit code 1 となり、出力ファイルを残しません。

## 寛容リーダー

| 入力形式 | 解釈 |
|---|---|
| `category` / `subject` / `決定` を含む markdown 表 | 行を `decisions[]` として構造化 |
| ラベル付きの 1 行パイプ形式 | `category` / `subject` / `checkpoint` 等を構造化 |
| 見出し・箇条書き・段落・コード | `blocks[]` として原文順を保持 |
| `>` で始まる連続行 | `blockquote` block として原文順を保持 |
| 必須 3 列を持たない markdown 表 | `table` block として原文に保持 |
| `(direction, tone)` の決定セル先頭にある JSON | `tone[]` / `tempo` を追加抽出（壊れていれば無視） |
| 画像パス | project 内の実在を確認し、出力 HTML からの相対 `src` を記録 |
| 裸の画像パストークン | ASCII のパス文字かつ区切りを含むものだけを収集し、グロブを除外 |
| グロブ・範囲表記（`*` `?` `–` `〜` `~`）を含む参照 | どの経路でも収集しない |

同じ `(category, subject)` の決定はファイル順で最後の行を現在有効とし、過去行は
`supersededBy` で後続行を参照します。日時による並べ替えは行いません。

## 設計原則

- **テンプレ + データ分離**: CLI は解釈・検証・束ねを担い、表示ロジックは `template.html` に置く
- **読み取り専用**: button、input、select などの決定 UI を持たず、決定はチャットで行う
- **派生物**: SSOT は常に `decision-log.md`。生成 HTML を手で編集しない
- **決定論**: 壁時計を埋め込まず、同じ入力と引数から同じバイト列を生成する
- **安全な局所参照**: 画像は相対パスで参照し、`data:` URI や外部接続を使わない
