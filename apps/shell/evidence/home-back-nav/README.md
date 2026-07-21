# home-back-nav（F47 戻る導線）L1 検証手法・証跡

タスク: ホーム v2（03 進め方フォーム / 04 作業中）に戻る導線を追加する最小修正。
オーナー実機症状「戻るボタンがないので、最初の画面に戻れない」の解消が目的。

## 実装の要旨

- `stage` getter に `reviewIntake` フラグを追加。intake が submitted 済みでも
  このフラグが立っていれば強制的に `'intake'`（03）を表示する
  （04「進め方を見直す」から 03 を開くための唯一の例外）
- 03 上部の「← はじめかたに戻る」は単一のハンドラ（`backToStarters`）で、
  一時選択状態（`starterChosen` / `reviewIntake`）をクリアするだけ。
  intake が未送信なら 02（starters）に落ち、見直し中（submitted 済み）なら
  04（workspace）に落ちる — 新しい state machine を増やさず、既存の
  `stage` getter の分岐だけで両方の「戻る」を賄う
- 04 の「進め方を見直す」（`openIntakeReview`）は submitted 済み
  `.akari/intake.json` を読み、tasks / duration / autonomy / taste を
  フォーム状態にプリフィルしてから 03 を表示する。再送信は既存の
  `submitIntake()` をそのまま使い、`submitted_at` を更新して上書きする
- `target.taste`（reference プロジェクトの自由文字列）はフォームに編集 UI が
  無いため、`intakeReviewTaste` に生値を保持し、`referenceProjectPath` を
  選び直していない限りそのまま再送信する（アプリ再起動後の見直しで taste が
  消えないようにするための最小の追加）
- 01（接続ゲート）への戻り導線は作っていない（task.md 指示3どおり）

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。既存タスク
（home-flow / theme-orange）と同じ手法で、今回は `puppeteer-core`
（`apps/shell/node_modules` に既存・追加インストールなし）で CDP 接続した。

1. `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペースへコピー（元ファイルは無改変）。
   `.akari/connections.json` の `akari-cloud` provider の `doctor.status` を
   検証用に手動で `ok` に書き換え（実 CLI 接続フロー自体は本タスクの対象外
   — F47 が対象にしているのは 03/04 間の状態遷移のみ）
3. `Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス> <隔離ワークスペース絶対パス>
   --remote-debugging-port=<port> --user-data-dir=<隔離dir> --no-sandbox` で直接起動
4. `puppeteer.connect({ browserURL: 'http://127.0.0.1:<port>' })` でアタッチし、
   `data-akari-home-stage` 属性の実測・ボタン/ラベルのテキストクリック・
   `.akari/intake.json` の直接読み取りで状態遷移を検証するスクリプトを書いて実行
5. 検証スクリプトの 1 回目でテキスト部分一致（`includes`）によるクリックヘルパーが
   誤爆した（後述「見つけた不具合」参照）。厳密一致（タスクの太字ラベル `<b>` の
   `textContent` が完全一致）に直して再検証し、正しい結果を得た
6. 後片付け: 起動した Electron は実 PID を指定して kill。隔離ワークスペース・
   ユーザーデータディレクトリ・検証スクリプトは検証後に削除（コミットしていない）

## 検証したシナリオと実測

| # | シナリオ | 実測 |
|---|---|---|
| 1 | 起動直後（接続済み・intake 未送信） | `data-akari-home-stage="starters"`（02） |
| 2 | 「相談しながら決める」選択 | `stage="intake"`（03）。上部に「← はじめかたに戻る」表示 |
| 3 | **03 の「← はじめかたに戻る」クリック** | `stage="starters"`（02）に復帰。task.md 指示1のゴール達成 |
| 4 | 02 → 03 → フォーム操作（BGM・効果音を追加チェック／尺 60 秒／おまかせ度 全部おまかせ）→ 送信 | `.akari/intake.json` が `{tasks:["transcribe-captions","silence-cut","bgm-sfx"], target:{duration_s:60,keep_length:false,taste:null}, autonomy:"full-auto", status:"submitted", submitted_at:"2026-07-21T09:41:43.239Z"}` で書かれ、`stage="workspace"`（04）に遷移。ヘッダー右上に「進め方を見直す」ボタン出現 |
| 5 | **04 の「進め方を見直す」クリック** | `stage="intake"`（03）に遷移し、以下を実測でプリフィル確認: チェック済み = 文字起こし・テロップ／いらない間・NG のカット／BGM・効果音（#4 で送信した内容と完全一致）、尺 = 60 秒、おまかせ度 = 全部おまかせ、バナー「以前送信した内容を表示しています。内容を直して送信すると上書きされます。」表示 |
| 6 | 見直し中にチェック内容と尺を変更 → 送信 | `.akari/intake.json` の `submitted_at` が新しい時刻に更新され、`tasks` / `target.duration_s` が変更後の内容に上書きされていることを確認 |
| 7 | 別ラウンド: 既知の状態（`tasks:["transcribe-captions","silence-cut"], duration_s:15, autonomy:"full-auto"`）から見直しを開き、厳密一致セレクタでプリフィルを再確認 → ナレーションのみ追加チェック → 送信 | プリフィル実測が直前の `.akari/intake.json` と完全一致（`checked:["文字起こし・テロップ","いらない間・NG のカット"], duration:"15 秒", autonomy:"全部おまかせ"`）。追加後 `checked` に「ナレーション（自分の声 / 既製の声）」のみが増え、他は不変。送信後の `.akari/intake.json` は `tasks:["transcribe-captions","silence-cut","narration"]`, `duration_s:15` のまま、`submitted_at` が `2026-07-21T09:41:44.712Z` → `2026-07-21T09:42:37.397Z` に更新（新しい時刻に前進していることを確認） |
| 8 | schema 準拠 | #7 で書かれた `.akari/intake.json` に対し `node packages/schemas/bin/validate-intake.mjs <path>` → `OK` / exit 0 |
| 9 | 新しいユーザーデータディレクトリで再起動（intake は既に submitted 済み） | ファイル SSOT どおり起動直後から `stage="workspace"`（04）に直行。02/03 は経由しない |
| 10 | #9 の状態から「進め方を見直す」→ 03 に遷移してから **「← はじめかたに戻る」をクリック** | `stage="workspace"`（04）に復帰（`"starters"` にはならない）。単一の `backToStarters` ハンドラが「intake 未送信なら 02 / submitted 済み見直し中なら 04」を正しく出し分けることを実測で確認 |

## スクリーンショット

| ファイル | 内容 |
|---|---|
| `01-starters-connected.png` | 起動直後、02（はじめかた 4 択） |
| `02-intake-fresh-with-back-link.png` | 02 → 03（相談しながら決める経由）。上部に「← はじめかたに戻る」 |
| `03-back-to-starters-after-click.png` | 「← はじめかたに戻る」クリック直後、02 に復帰 |
| `04-workspace-with-review-entry.png` | 初回送信後の 04。ヘッダー右上に「進め方を見直す」ボタン |
| `05-review-prefilled-form.png` | 04 →「進め方を見直す」→ 03。バナー表示 + プリフィルされたチェック状態 |
| `06-review-edited-narration-added.png` | 見直し中にナレーションを追加チェックした直後 |
| `07-workspace-after-resubmit.png` | 見直し内容を再送信し 04 に戻った状態 |
| `08-review-back-button-visible-in-review-mode.png` | 新しいユーザーデータディレクトリでの再起動直後に「見直す」で開いた 03（見直しモードでも「← はじめかたに戻る」が出ることの確認） |
| `09-review-back-lands-on-workspace.png` | #8 の状態から「← はじめかたに戻る」を押した直後、04（workspace）に復帰した状態 |

## 見つけた不具合（検証スクリプト側・実装側ではない）

1 回目の検証スクリプトは「クリックしたいラベルのテキストを含む」という部分一致
（`textContent.includes(...)`）でクリック対象を探していたが、BGM・効果音タスクの
説明文に「ナレーション中は自動で音量ダウン」という一文があり、「ナレーション」を
検索語にした際に BGM・効果音のラベルへ誤って一致してクリックしてしまった
（実装のバグではなく、検証スクリプトの部分一致セレクタの誤り）。厳密一致
（タスクの太字ラベル `<b>` の `textContent` が検索語と完全一致するものだけを
対象にする）に直したところ、シナリオ#7 のとおり正しい結果が得られた。
プロダクトコード自体はこの問題の影響を受けていない
（誤クリックで送信された1回目の `.akari/intake.json` の内容自体は
「入力されたチェック状態をそのまま保存する」という仕様どおりの正しい動作であり、
検証スクリプトが意図と異なる要素をクリックしていただけ）。

## 未確認事項

- 01（接続ゲート）は本タスクで一切変更していないため、実 CLI 接続フローの
  再検証は行っていない（`connections.json` を検証用に直接書き換えて 02 から
  開始した）
- Windows/Linux での再現性は未確認（macOS のみで検証）
- 04 の「進め方を見直す」ボタンは `hasAssets` の有無に関係なくヘッダーに
  常設しているため、素材未取り込み（ドロップゾーン表示）の状態でも見えることは
  コード上自明だが、その状態でのスクリーンショットは撮っていない
