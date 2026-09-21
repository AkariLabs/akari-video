# AKARI バイブ

このディレクトリは内部リポジトリの正本から自動生成する配布物です。直接編集しないでください。
変更は内部へ戻し、検査を通して書き出し直します。版はシェルと一緒に管理します。
判断は `https://akari.video/api/vibe` のサービスで行い、その実装は同梱しません。

## 起動

シェルの backend が `node bin/akari-vibe.mjs --serve` を子プロセスとして起動します。
Electron では `process.execPath` と `ELECTRON_RUN_AS_NODE=1` を使います。
シェルが32バイトの乱数を作り、標準入力の最初の行に
`{"token":"<64桁の16進文字列>"}` と改行を渡します。合言葉を引数や環境変数へ置かないでください。
標準入力は接続中開いたままにします。閉じると係は1秒以内に終了します。

待受けは `127.0.0.1:0`。標準出力の最初の行は
`{"type":"listening","port":<整数>,"protocol":0}` です。
シェルは Bearer 認証で `/companion/manifest?nonce=<32桁>` を取得し、
合言葉を鍵とした nonce の HMAC-SHA256 を照合します。
manifest の `panelPath` が返す `?k=` を枠の通信に付けます。合言葉と panelPath はログに残しません。
`companion.json` は書かず、HUD の待受けも開きません。記録も既定では書きません。
同時に動く係は1つとし、シェルがウィンドウの切替・終了時に停止を管理します。

## 資源と設定

公開モノレポ、アプリの Resources とも `packages/akari-vibe` と
`packages/edit-store/lib` を並べ、根に `presets` を配置します。
聞き取りのビルド済みヘルパーは `native/bin/akari-vibe-stt` に置きます。
対応外 OS やヘルパー未同梱でも係は起動し、聞き取りが使えないことを枠に表示します。

| 環境変数 | 用途 |
| --- | --- |
| `AKARI_PUBLIC_REPO` | 公開資源の根。通常は相対配置から見つけます |
| `AKARI_EDIT_STORE_LIB` | edit-store の index.js の明示指定。相対配置より優先します |
| `AKARI_HOME` | Lab 接続情報の親。既定は `~/.akari` |
| `AKARI_VOICE_JUDGE_TOKEN` | Lab 接続の鍵を明示指定 |
| `OPENROUTER_API_KEY` | 利用者の鍵を明示指定 |
| `AKARI_CREDENTIALS_FILE` | 利用者の鍵を読む env ファイル |
| `AKARI_VOICE_JUDGE_URL` | 判断 API の接続先。製品の既定は上記サービス |
| `AKARI_VOICE_JUDGE_TRUST_HOST` | `1` のときだけ別の HTTPS ホストへの鍵の送信を明示許可 |
| `AKARI_VIBE_STT_BIN` | 聞き取りヘルパーの明示指定 |
| `AKARI_VIBE_LOG_DIR` | 明示した場合のみ記録する場所 |
| `AKARI_VIBE_DEV` | `1` の場合は開発用の口とヘルパーのローカルビルドを有効化 |
| `AKARI_LIBRARY_SOURCE` / `AKARI_CATALOG_JSON` | 素材台帳の方式とファイル |

Lab 接続の鍵は `AKARI_VOICE_JUDGE_TOKEN`、次に `AKARI_HOME/store-credentials.json`
（未指定なら `~/.akari/store-credentials.json`）の token を使います。
利用者の OpenRouter の鍵は `OPENROUTER_API_KEY` → `AKARI_CREDENTIALS_FILE` →
`~/.config/akari-video/credentials.env` → 旧 `~/.config/akari/openrouter.env` の順に探します。
ファイルは呼び出すたびに読み直します。登録後の再起動は不要です。

通常、保存済みの両方の鍵を送る相手は HTTPS の `akari.video` だけです。
Lab 接続の鍵を Authorization、利用者の鍵を `x-akari-provider-key` に載せ、
サービスの `/judge` へ送ります。係からモデル提供先へ直接送ることはありません。
リダイレクトは拒否します。別ホストへの送信は上表の明示許可がある場合だけです。
ローカル接続先には保存済みの鍵を送らず、明示した Lab token のみ送ります。
戻り値と通信エラーから鍵を除去し、状態確認では登録の有無だけを返します。

## テスト

依存のインストールは不要です。公開のモノレポ配置で
`node --test test/*.test.mjs` を実行します。
判断 API は呼びません。鍵の試験は fetch の差し替え、起動の試験は一時ホームと OS が選ぶポートを使います。
