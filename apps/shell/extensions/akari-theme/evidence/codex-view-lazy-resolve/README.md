# Webview resolve timing observer

隔離起動したアプリの CDP ポートへ、生の Chrome DevTools Protocol で接続する計測スクリプトです。アプリや拡張を起動する処理は含みません。Node 22 以降で実行してください。

## 隔離起動

以下は Windows PowerShell の例です。`<WORKTREE>` はこのリポの worktree、`<TMP>` は計測専用の一時ディレクトリ、`<HOME>` は Codex 拡張が既に配備された元のホームです。`<TMP>` は新規に用意し、他のアプリのプロファイルと共有しません。

```powershell
$worktree = '<WORKTREE>'
$scratch = '<TMP>'
$sourceHome = '<HOME>'
$port = 9490
New-Item -ItemType Directory -Force "$scratch/home/.theia/deployedPlugins", "$scratch/temp", "$scratch/akari" | Out-Null

# 必要な Codex 拡張の版だけを元の deployedPlugins から隔離先へ複製する。
Copy-Item -Recurse -LiteralPath "$sourceHome/.theia/deployedPlugins/openai.chatgpt-<version>" -Destination "$scratch/home/.theia/deployedPlugins/"
# パートナーの接続設定や他のホーム設定は複製しない。
[System.IO.File]::WriteAllText("$scratch/akari/update-preferences.json", '{"channel":"stable","autoCheck":false}', (New-Object System.Text.UTF8Encoding($false)))

$env:HOME = "$scratch/home"
$env:USERPROFILE = "$scratch/home"
$env:TEMP = "$scratch/temp"
$env:TMP = "$scratch/temp"
$env:AKARI_HOME = "$scratch/akari"
$env:CODEX_HOME = "$scratch/home/.codex"
$env:THEIA_CONFIG_DIR = "$scratch/home/.theia"
```

まず別の端末で observer を待機させ、その後に上の環境を設定した端末で `apps/shell` から Electron を起動します。`--remote-debugging-port` は他の起動中アプリと重複しない番号にしてください。

```powershell
# observer 側: <WORKTREE> で実行
node apps/shell/extensions/akari-theme/evidence/codex-view-lazy-resolve/observe.mjs --port 9490 --out '<TMP>/codex-view-events.jsonl' --seconds 90

# Electron 側: 上記の隔離環境を設定済みの端末で実行
Set-Location "$worktree/apps/shell"
& "$worktree/node_modules/electron/dist/electron.exe" . --user-data-dir="$scratch/profile" --remote-debugging-port=$port --plugins=local-dir:plugins
```

`AKARI_HOME/update-preferences.json` の `autoCheck:false` でアプリの自動更新確認を切ります。計測後は、この起動で生成した Electron プロセスだけを終了し、隔離先を片付けてください。

```sh
node apps/shell/extensions/akari-theme/evidence/codex-view-lazy-resolve/observe.mjs --port 9490 --out .tmp-lane/codex-view-events.jsonl --seconds 90
```

`--port` は `AKARI_CDP_PORT`、`--out` は `AKARI_CDP_OUT`、`--seconds` は `AKARI_CDP_SECONDS` でも指定できます。出力は JSON Lines で、各行に壁時計の ISO 時刻と観測開始からの経過ミリ秒を含みます。計測結果はこのディレクトリに保存せず、隔離作業用の出力先を指定してください。

スクリプトは `plugin-webview` の各 `WebviewWidget` を見つけ、`setHTML` 時の可視状態と iframe の有無、可視状態の遷移、webview からの `ready` メッセージ、通知文言を記録します。アプリ起動前から observer を待機させると、最初の HTML 設定も捕捉できます。HTML 本文や接続情報は出力しません。接続したページの `setHTML` を書き換える（計測用の差し込み）ので、隔離したインスタンスにだけ使ってください。
