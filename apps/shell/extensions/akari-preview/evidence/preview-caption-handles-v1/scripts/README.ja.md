[English](./README.md) | **日本語**

# 字幕選択ハンドル L1

ラッパーが Electron バンドルをビルド済みのチェックアウトで実行する。スクリプトはビルドも依存追加もしない。`before` は修正前（75c3c736）、`after` は修正後のバンドルで、順番に実行する。

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/run-l1.sh before
# この間にラッパーが修正後のアプリをビルドする。
bash apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/run-l1.sh after
```

ランチャーは CDP ポートの空きを検査し、隔離プロジェクトとユーザープロファイルで Electron を直接起動する。終了時は自分が起動した PID と一時ディレクトリだけを片付ける。preview-modifier-keys-v1 の型を踏襲し、timeline-tracks の CDP・`realClick`・`screenshot` を読み込む。製品リポジトリで Git の変更操作はしない。初期コミットは使い捨て fixture 内だけに作る。

必要条件: ビルド済み shell / edit-store、WebSocket 内蔵 Node、ffmpeg、Git、GUI デスクトップ。`ELECTRON_BIN` で実行ファイルを指定できる（macOS の標準位置は自動探索）。`AKARI_CDP_PORT` の既定値は 9767、`AKARI_FFMPEG` は ffmpeg の指定。起動失敗も対象の run-log を FAIL に置き換えて非ゼロ終了する。

fixture は `templates/project-default` に `packages/render-cut/test/fixtures/caption-item-render` を重ねる。宣言済み字幕 bag、生成 PNG 背景、字幕 3 本を使用。c-0001 / c-0002 は 0.25〜2 秒に上下別位置で同時表示、c-0003 は 2.5〜4.5 秒。2.25 秒には字幕がない。c-0001 / c-0003 は main 素材時刻、c-0002 は出力時刻とし、captions-overlap-foundation と同じく同一時刻グループの重なり検査に違反しない構成にする。準備時に既存のプロジェクト write gate で検証してから一時 Git を初期化する。コミットせず fixture だけを検証する例:

```sh
node apps/shell/extensions/akari-preview/evidence/preview-caption-handles-v1/scripts/prepare-fixture.mjs /tmp/akari-caption-fixture-check --lint-only
```

`before` は実クリックで「青い箱が active・`data-selected` なし・ハンドル 0 個」を記録する。続いて 10 分間、時刻の前後移動・同時刻 2 本・実テキスト編集の直後の行数で字幕消失の再現を試す。各標本に期待する字幕 ID、可視行、選択状態を残す。消失は `reproduced: true`、未再現も明記し、描画を修正したとは扱わない。`AKARI_CAPTION_PROBE_MS` はランナーのデバッグ用に時間を短縮できるが、指定時間・実時間をログに残し、短縮実行を 10 分の受け入れ証跡にはしない。

`after` は同じクリック、黄色 outline の computed style、ハンドル 5 個、選択行の破棄・再生成、拡縮の live 値と保存、Shift 回転、位置保存、ホストの単数・複数選択、集合内の primary 変更、空きクリック / Esc の解除、編集中 Esc・同時表示の回帰を検証する。回転はドラッグの全イベントに `modifiers=8` を送り、保存角度が非ゼロかつ 15° の倍数であることを要求。ホスト選択は main ウィンドウの既存経路 `akari.daihon.selectionChanged` / `akari.timeline.primarySelected` を使い、webview に届いたメッセージを観測する。webview 内の選択状態を直接書き換える代用はしない。ジェスチャーと入力は CDP の実入力を使う。

シークは `akari.preview.seekOutput` の `waitForReady: true` を使う。この既存経路は現行 renderer / model の準備を待ち、初期再生復元を停止し、一時停止して通常のシーク処理を通す。ランナーは時計の準備と十分な尺を先に確認し、新しい `playbackTick` の実時刻が期待時刻と一致し、一時停止している状態を連続 2 回の観測で要求する。frame-engine の期待値は実装の `Math.round(time * fps) / fps` に従い、30fps の 2.25 秒なら frame 68（68/30 秒）に一致する必要がある。許容誤差は 1e-6 秒で、スライダー判定を緩める変更ではない。観測フックは元の再生通知をそのまま呼び、時計には値を代入しない。iframe の置換時は接続し直し、同じ目標時刻で最大 3 回試行する。`seeks` に要求時刻、期待フレーム、試行、実時計、スライダーの診断値を残す。字幕・ハンドルの期待値は変更しない。

保存先の注意: 現行 `handleCaptionWrite` は `edit.json` ではなく `captions.json` の `text_style.scale` / `rotate` / `position` を保存する。ランナーは両方のファイルを記録し、実際のサイドカー保存値と隣の字幕が無変更であることを検証する。保存先を `edit.json` に移す変更は字幕選択区域の限定編集を超える。契約の「edit.json に保存」との相違は run-log に明示し、edit.json への書き込み成功と偽って扱わない。

CDP のコマンド戻り値は main ウィンドウ内で JSON のスカラー値と型名だけに要約する。ウィジェット、循環参照、getter、独自の直列化処理は `returnByValue` に渡さず、`seeked` の文字列判定は維持する。`commands` に呼び出し時刻と安全な要約を記録する。起動時はタイムラインを 1 回だけ開き、タイムアウトしたウィジェット操作を重ねて発行しない。context の破棄・全消去・接続切断で接続状態を無効にし、読み取り観測は現行 context を再探索する。マウス・キー操作を置換後の文書へ再送することはない。文書ごとの観測 ID により、別ページの時計通知が前のシークを成功させることを防ぐ。ホスト選択は対応メッセージの到着、テキスト入力はフォーカス中の編集要素の実内容を待つ。`runner-support.mjs` の純粋な補助処理は `test/preview-caption-handles-runner.test.mjs` で headless 検証する。

ログは `../run-log-before.json` / `../run-log.json`、スクリーンショットは `before-*` / `after-*` で分離する。after は 1 件でも失敗すれば exit 1、未実行項目は PASS にせず `not-run`。before も期待した退行がない場合や再現試行を実施できなかった場合は exit 1。既存の preview-modifier-keys-v1 と captions-overlap-foundation の全体実行は別途ラッパーが担う。このランナーは字幕の Shift / Esc・同時表示の検証を含むが、既存スイート全体の実行を代行したとは扱わない。
