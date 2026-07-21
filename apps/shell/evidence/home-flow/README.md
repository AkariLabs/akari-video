---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-21
---

# home-flow（ホーム v2）L1 検証手法・証跡

タスク: ホーム v2 — 接続ゲート → はじめかた 4 択 → intake サーフェス → 地図。
4 状態フローの実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。既存タスク
（partner-pane / theme-orange）と同じ手法: `playwright-core` を依存追加なしの
一時作業ディレクトリで使い回し（`chromium.connectOverCDP`）、`node_modules/electron/dist`
の実バイナリを直接起動した。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペースへコピー（元ファイルは無改変）
3. `Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス> <隔離ワークスペース絶対パス>
   --remote-debugging-port=<port> --user-data-dir=<隔離dir> --no-sandbox` で直接起動
4. 接続ゲートの CTA（「パートナーに接続する」）は**実際にクリックして実 CLI 接続を検証した**
   （T4 のダミー CLI 代替は使わなかった — この検証環境には実行可能な `claude` CLI が
   既にあったため、`begin()` の本番コードパスがそのまま完走し、実 PTY が起動した）。
   拡張の README コンパイルなど無関係な非同期ワーニングは出るが接続完了には無関係
5. 接続直後の `AkariPartnerWidget.attachTerminal()` の状態確認のみを目的に、一時デバッグ
   フック（`globalThis.__akariPartnerWidgetDebug = this`、T4 と同じ流儀）を
   `AkariPartnerWidget.init()` に追加して検証し、**証跡取得後に完全に削除してから
   最終コミットした**（`git diff` で確認済み・最終差分に当該フックは含まれない）
6. 進め方フォームの操作（チェックボックス・尺/おまかせ度のピル・送信ボタン）は
   Playwright の実クリック操作で行った。ピル要素は `opacity:0` の `<input>` を
   `<span>` の上に絶対配置しており、選択のたびに再レンダーが走るため actionability の
   stability チェックが収束しないケースがあった。`force:true` で明示的にスキップして
   操作した（UI 自体の不具合ではなく、テスト操作上の回避）
7. 開発者モードの既定値: この検証環境では `akari.developerMode` が `true` の状態で
   起動した（本タスクが変更した設定ではない — 原因未特定、§未確認事項参照）。生ターミナル
   ではなくガワ（吹き出し UI）での見え方も確認するため、`PreferenceService.set(...)` で
   明示的に `false` へ切り替えてから 02〜04 のスクリーンショットを撮った
8. 後片付け: 起動した Electron は実 PID を指定して kill。隔離ワークスペース・
   ユーザーデータディレクトリは検証後に削除しコミットしていない

## 状態遷移の実測（`data-akari-home-stage` 属性で確認）

| 状態 | スクリーンショット | 実測 stage 値 |
|---|---|---|
| 01 未接続（connections.json 全 provider `unchecked`） | `01-gate-disconnected.png` | `gate` |
| CTA クリック直後（接続進行中、ボタン disabled 表示） | （ログのみ） | `gate` |
| 接続完了直後（`akari-cloud` provider の doctor が自動で `ok` に） | `02-starters-after-connect.png` | `starters` |
| はじめかた「相談しながら決める」選択後 | `03-intake-form.png` | `intake` |
| フォーム送信後（`.akari/intake.json` が `submitted` に） | `04-workspace-after-submit.png` | `workspace` |
| メニュー widget を開いた状態（「ひらく」「やらせる」表示を確認） | `05-menu-widget-first-appearance.png` | `workspace` |
| タイムラインを開いた状態（非退行の起動確認） | `06-non-regression-timeline.png` | `workspace` |
| **新しいアプリプロファイルで同じワークスペースを再起動**（レイアウト復元に頼らず、ファイル SSOT だけで 04 に直行することの確認） | `07-relaunch-skips-gate.png` | `workspace`（起動直後から。ゲートも 02/03 も一切表示されない） |

## 実測結果の要旨

| 項目 | 結果 |
|---|---|
| 01 の見た目 | マーク・見出し・CTA・注記のみ。ドロップゾーン・左パネルとも非表示（`01-gate-disconnected.png`） |
| 左パネル gating | 01〜03 では activity bar に「素材」「メニュー」アイコンが一切出ない（検索・拡張・設定のみ）。04 到達時に初めて両方出現し、メニューを開くと「ひらく」（タイムライン/文字起こし/ホーム/変更を見る）と「やらせる（スキル）」が表示される |
| 接続の自動反映 | CTA クリック → 実 CLI 接続成功 → `connections.json` の `akari-cloud` provider の `doctor.status` が自動で `ok`（`last_checked` に実時刻）に更新されるのを確認。新しい判定基準は作らず、既存 SSOT を実態に追従させただけ |
| 02 はじめかた 4 択 | 4 枚のカードがモック文言通りに表示。「相談しながら決める」選択で 03 に遷移し、選択に応じた要約メッセージ（「まだ何も決まっていません。相談しながら方向性を決めたいです。」）が実際にパートナーのチャンネルへ送信された（実 CLI の PTY にテキストが届いたことをチャットログで確認） |
| 03 送信（A→B の順） | 送信ボタンで A) `.akari/intake.json` が `status: "submitted"` + `submitted_at` 付きで書かれ、B) その直後に要約メッセージ（やること/尺/おまかせ度）がパートナーへ送信されるのを確認（`04-workspace-after-submit.png` のチャットログに実際に流れた要約文が写っている） |
| intake.json の schema 適合 | `node packages/schemas/bin/validate-intake.mjs <書き込まれた intake.json>` → `OK` / exit 0 を実測 |
| ファイル SSOT の永続性 | 送信後、**新しいアプリプロファイル**（Theia のレイアウト復元キャッシュに頼らない）で同じワークスペースを再起動しても、01/02/03 を経由せず直接 04 に到達（`07-relaunch-skips-gate.png`）。接続状態・intake 状態がどちらもファイルだけから復元されることを確認 |
| 非退行 | タイムラインを開いて undo/redo ボタン・ズームスライダー・トラック行が通常通り表示されることを確認（`06-non-regression-timeline.png`）。起動確認レベルでの非退行 OK |
| L0 | `npm run build:ext` / `npm run lint` とも exit 0（デバッグフック除去後の最終状態で再実行して確認済み） |
| `packages/intake-form` の L0 | `node --test test/*.mjs` で 4 件 pass。うち 1 件はサーバが書いた `intake.json` が `validate-intake.mjs` を通ることまで検証 |

## 未確認事項

- 開発者モードがこの検証環境で既定 `true` になっていた原因は特定していない
  （本タスクで新規追加した設定ではなく、`akari.developerMode` は既存 T1/T4 実装が
  所有するプリファレンス。ワークスペーステンプレート側の既存状態か、検証環境固有の
  要因かは未調査。ホーム v2 の左パネル gating ロジック自体は developer mode の値に
  かかわらず正しく動作することは確認済み — 04 未到達では常に隠れ、04 到達後は
  developer mode に応じて素材ビューの中身だけが入れ替わる）
- 実 CLI 接続を使ったため、ダミー CLI／実 CLI 不可時のフォールバック経路自体は
  今回検証していない（今回は実 CLI が使えたため優先して実施した。フォールバック手順は
  T4 の README に記載された手法をそのまま踏襲する想定）
- ANSI エスケープ除去は簡易実装（T4 から引き継いだ既知の制約）。実 CLI の
  対話的プロンプト（罫線・カーソル制御）は今回のチャットログでも一部読みにくい
  形で残った。改善は本タスクのスコープ外
- 「過去のプロジェクトを参考に」の参照パス渡し（v0）はコードレビューと
  単体の folder-picker 呼び出し確認のみで、実機クリック→フォルダ選択の
  E2E は行っていない（ネイティブファイルダイアログが CDP 自動化と相性が悪いため、
  今回は「相談しながら決める」経路で 03 への遷移を実証した）
- 「素材から始める」も同じ理由でネイティブダイアログを伴うため実クリックでの
  E2E は行っていない。`pickFiles()` 自体は v1 から既存・変更していないコードパス
- Windows/Linux での再現性は未確認（macOS のみで検証）
- 「02 か 03 かは実装に任せる」（契約の遷移表の注記）は、intake 未送信の間は
  常に 02（はじめかた）を再表示する実装を選んだ。はじめかた選択後 03 への遷移は
  メモリ上のみの一時状態で永続化しない — アプリ再読み込み・再起動すると 02 に戻る
  （送信済みかどうかだけがファイルで永続化される）
