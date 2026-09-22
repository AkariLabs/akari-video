# L1 証跡 — 設定ダイアログ刷新（settings-dialog-refresh）

カード型の見た目・自前の部品（ドロップダウン / セグメント / スイッチ / 選択カード）・「Akari アカウント」と「外観」の新設・
公式ロゴと「残高を見る」を、実機（Electron + CDP）で観測した記録。見た目の正は内部リポのモック 3 版（① 設定ダイアログ）。

## 再現手順

```sh
cd apps/shell
npm run build                                   # build:ext → theia build --mode production
S=$(mktemp -d)                                  # 以下 <SCRATCH>
mkdir -p "$S/ws" "$S/udd" "$S/cfg" "$S/akari-home" "$S/out"
cp -R ../../templates/project-default/. "$S/ws/"
# 偽のキー（残高の問い合わせは下の模擬サーバーへ向く。実キーは使わない）
printf 'OPENROUTER_API_KEY=sk-or-v1-l1-fake-000000001234\nFAL_KEY=fal-l1-fake-000000005678\n' > "$S/cfg/credentials.env"
chmod 600 "$S/cfg/credentials.env"
MOCK_PORT=9458 MOCK_LOG="$S/mock.log" node extensions/akari-surfaces/evidence/settings-dialog-refresh/mock-balance-server.mjs &
THEIA_CONFIG_DIR="$S/cfg" AKARI_CREDENTIALS_FILE="$S/cfg/credentials.env" AKARI_HOME="$S/akari-home" \
AKARI_BALANCE_API_ORIGIN=http://127.0.0.1:9458 \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron "$PWD" "$S/ws" \
  --remote-debugging-port=9457 --user-data-dir="$S/udd" --no-sandbox &
L1_PORT=9457 L1_OUT="$S/out" L1_SETTINGS="$S/cfg/settings.json" L1_MOCK_LOG="$S/mock.log" \
PLAYWRIGHT_CORE=<playwright-core の index.js> node extensions/akari-surfaces/evidence/settings-dialog-refresh/run-l1.mjs
```

`AKARI_BALANCE_API_ORIGIN` は検証専用の向け替えで、ループバック（`http://127.0.0.1` / `http://localhost`）以外の値は無視する
（`balanceRequestUrl`・単体テストで固定）。

## 実測（2026-09-22 / macOS arm64 / Electron 39 / ダイアログ 1040 × 760 / 1 回の実行 56 秒）

| 観測項目 | 結果 |
|---|---|
| ナビの順 | Akari アカウント / はじめかた / 書き出し / 外観 / 接続と API キー / 文字起こし / プレビュー品質 / 通知 / 道具 / —開発者— / 開発者モード（モックと同じ） |
| 保存値なしで開いたときの節 | `account`（先頭） |
| 選択中ナビの computed `border-inline-start-width` | **全 20 画面（10 節 × ダーク / ライト）で `0px`**（`border-left-width` も `0px`） |
| 選択中ナビの面 / 文字 / アイコン | ダーク `rgb(26, 26, 26)`（= elevated）・太字 600・アイコン `rgb(249, 115, 22)`（accent）。ライト `rgb(229, 229, 229)`・アイコン `rgb(234, 88, 12)`。非選択は透明 |
| DOM 上の素の `select` / `input[type=radio]` / `input[type=checkbox]` | **全 20 画面で 総数 0・可視 0** |
| 自前ドロップダウン（形式 / コーデック）のキーボード操作 | フォーカス + ArrowDown → `aria-expanded=true`・一覧が表示・フォーカスが listbox へ。ArrowDown × 2 → 活性 `prores422`。Enter → 表示「MOV · ProRes 422 HQ」・閉じる。もう一度開いて Esc → 一覧だけ閉じ、**設定ダイアログは開いたまま（1 個）** |
| 書き出し画質・形式の保存（settings.json の前 → 後） | `akari.export.quality`: （未設定 = 既定 standard）→ `master` / `akari.export.codec`: （未設定 = 既定 h264）→ `prores422` |
| 文字起こしのモード（カード） | `akari.transcribe.mode`: （未設定 = 既定 simple）→ `advanced`。アドバンスでグループ「モード / エンジン / アドバンス」・スイッチ 2・チェック 4 |
| テーマのカード（外観） | `workbench.colorTheme`: （未設定 = 既定 dark）→ `light`。body クラス `theia-dark` → `theia-light`、`--akari-bg` `#0a0a0a` → `#ffffff`、`color-scheme` dark → light。ダークへ戻すカードでも同様に戻る |
| Akari アカウント | Store の中身が 1 個（`data-akari-store-settings`）、状態「未接続」、「Store を開く」の先 **`https://akari.video/lab/`**。「プラン」の枠なし |
| 接続と API キーの Store | **0 個**（`data-akari-store-settings` / `data-akari-store-group` とも） |
| グループ | 生成 AI（fal / OpenRouter / ElevenLabs / Replicate）/ 文字起こし（Groq）/ キーの保存先（セグメント「このファイル」選択・「暗号化」無効） |
| 公式ロゴ | 5 社すべて読めた（`naturalWidth`: fal 180 / OpenRouter 180 / ElevenLabs 500（SVG）/ Groq 33（SVG）/ Replicate 96） |
| 状態のピル | fal・OpenRouter「接続済み」（キー登録済み）/ ElevenLabs・Replicate・Groq「未接続」 |
| 残高を見る | OpenRouter・fal = 押せる / ElevenLabs = **無効 + 「未接続」**（キー未登録）/ Groq・Replicate = ボタン無し・「管理画面」リンクのみ |
| 押す前の問い合わせ | 模擬サーバーの受信 **0 件**（開いただけでは取りにいかない） |
| 押した後 | OpenRouter「残り $4.72 · たった今」（`GET /api/v1/key`・Bearer）/ fal「残り $18.40 · たった今」（`GET /v1/account/billing?expand=credits`・Key）。受信はちょうど 2 件（`mock-requests.jsonl`） |
| console error | 0 件 |

## モックとの構成の照合（節ごとのグループ・部品）

| 節 | モック 3 版 | 実機（DOM から数えた値） |
|---|---|---|
| Akari アカウント | アカウント帯（ログイン状態 + ボタン）/ AKARI STORE（接続・Store を開く）/ ~~プラン（準備中）~~ | アカウント帯 / AKARI STORE（接続のピル・Store を開く）。プランは契約どおり出さない（将来の席はコードのコメント） |
| はじめかた | 大きなカード + セットアップを開く + 進み具合 3 枠（案） | 大きなカード + セットアップを開く + 進み具合 2 枠（道具 n / m・API キー n / m。素材フォルダは状態を読む口が無いので出さない） |
| 書き出し | 画質 4 カード / 形式: ドロップダウン + エンコーダ・fps セグメント / 保存先: フィールド + 選ぶ・くわしい設定 | カード 4・ドロップダウン 1・セグメント 2・入力 1（同じ 3 グループ） |
| 外観 | テーマ 3 カード（ダーク / ライト / システム） | カード 2（ダーク / ライト）。システム追従は Theia 1.73 に実装が無いので出さない |
| 接続と API キー | 生成 AI / 文字起こし / キーの保存先・ロゴ・ピル・残高を見る | 同じ 3 グループ・ロゴ 5・残高の口 3・fal の既定モデルはドロップダウン 2 |
| 文字起こし | モード 2 カード / エンジン: セグメント + ドロップダウン / アドバンス: スイッチ + チェック 4 + スイッチ | 同じ（簡単のときはアドバンスのグループの代わりに 1 行の注記） |
| プレビュー品質 | Draft / Final カード + 注記 / タイムライン: スイッチ | カード 2・注記・スイッチ 1 |
| 通知 | スイッチ 1 | スイッチ 1 |
| 道具 | 行（アイコン・名前・用途・状態ピル or ボタン）/ 素材フォルダ: フィールド + 選ぶ | 同じ（行 7・状態を確認し直す・素材フォルダ） |
| 開発者モード | スイッチ 1（テーマは外観へ） | スイッチ 1 |

## ファイル

| ファイル | 内容 |
|---|---|
| `dark-01-account.png` 〜 `dark-10-developer.png` | ダークの全 10 節 |
| `light-01-account.png` 〜 `light-10-developer.png` | ライトの全 10 節（外観のカードで切り替えた後） |
| `dark-11-connections-balance.png` | 残高を見るを押した後（OpenRouter・fal） |
| `dark-12-export-dropdown-open.png` | 形式 / コーデックのドロップダウンをキーボードで開いたところ |
| `dark-13-transcribe-advanced.png` | 文字起こしをアドバンスにしたところ |
| `measurements.json` | 上表の生データ（ホームは `<HOME>` に置換） |
| `mock-requests.jsonl` | 模擬サーバーが受けたリクエスト（パスと認証ヘッダの種類だけ・キーは記録しない） |
| `run-l1.mjs` / `mock-balance-server.mjs` | 観測スクリプト / 残高の模擬サーバー |
