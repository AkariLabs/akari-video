[English](./README.md) | **日本語**

# プレビュー階層選択の L1 スクリプト

ビルド済み Electron と、グローバルの `WebSocket` / `fetch` を備えた Node を使う。
このスクリプトはビルド・依存導入を行わない。

```sh
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh before
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh after
```

引数は環境変数 `L1_MODE` に優先し、既定は `after`。`ELECTRON_BIN` で macOS 向け
既定実行ファイルを上書きできる。CDP ポート使用中は起動せず、readiness は最大600秒待つ。
終了時は自分で起動した Electron の PID と一時 workspace / user data を片付ける。
構文だけの確認は各 `.mjs` に `node --check`、シェルに `bash -n run-l1.sh` を使う。

`prepare-fixture.mjs <workspace>` は `<workspace>/project` を作り、既存 project の
上書きを拒否する。標準テンプレートと読み取り専用の `object-tree-html-bag` を複製し、
同じ edit.json 内で `g1` を `outer` で包む。複製側だけ、クリック対象を分離するため
変形を調整し、`g1.second.at` を0にする。1.5秒で group の子2枚が同時に見える。
元の ID、HTML、袋のマスク、走査だけの A / 明示子 B の区別を保つ。
この調整後に複製プロジェクトだけで git 初回コミットを作る。製品リポはコミットしない。
BEFORE / AFTER の比較時は fixture の edit.json ハッシュ一致を必須とする。

BEFORE は指示0だけを実行する。`g1.first` と `s01#A` を通常クリック・実ドラッグし、
選択、write、webview が受け取る `akari-preview-overlay-write-response`、各操作前後の
累積 `git diff HEAD -- edit.json` を記録する。`ok:false` で保存されない場合も、
応答を観測できれば BEFORE は PASS。新しい状態 getter は不要。

AFTER は11手順を個別の `ok` / `ng` と観測値で記録する。手順1は同じ葉への書き込みを
調べるため ⌘ / Ctrl クリックを使い、BEFORE ログがあれば対応する記録を並べる。
手順1で A の明示子が作られた後は `source.part === 'A'` から ID を読み直す。
手順2〜5の group は `outer`、手順8は `outer > g1 > g1.first` 全体、手順10は
タイムライン上の `g1` 行を使う。手順8は Esc の各打鍵の直前・直後に widget の
`focusScope.rootId`、選択 ID、選択行 ID を読み、その打鍵前の値と不変比較する。
手順10は選択解除後も含め、プレビューで4回 Esc を押して床の外に出ないことを確認する。

第2段は `run-l1.mjs` 冒頭の `EXPECTED_STATE_API` と同じ名前の読み取り専用 getter を
実装すること: `window.akari.interaction.selectedId` / `scopeId` / `floorScopeId`
（string または null）、`activeEdit`（boolean または object/null）。欠ければ AFTER は
FAIL。スクリプトが getter を代作したり API で選択状態を書き換えたりすることはない。
ポインタ・キー操作は CDP Input。evaluate は状態読取、既存 UI の起動、1.5秒へのシーク、
観測 hook の設置に使う。`engine.overlayWrite` の観測ラッパーは元の引数と promise を
そのまま通し、window message listener は実際の応答を記録する。src の編集は不要。

出力は scripts の1段上: `run-log-before.json` / `run-log.json` と必要な手順・失敗時の
PNG。AFTER は BEFORE ログを上書きしない。ログには status、手順別観測値、受信イベント、
ファイル内容と差分、失敗詳細を含める。PASS は exit 0、FAIL は exit 1。起動失敗も新しい
FAIL ログにする。対象は指示0・9であり、指示10の別途回帰スイートは起動しない。

AFTER は共有の `readInternalEdit` → `expandBagOverlays` を保存値の検証器に使う。
group だけが合成され、袋と部品はキー単位で上書きされる。保存した葉について、
まず旧 ID で実 DOM の CSS を記録し、`ApplicationShell.closeWidget` で対象の出力
プレビューを閉じ、`akari.preview.ensureVisible` で開き直して1.5秒へシークする。
その後、保存後の ID で新しい DOM の CSS と write の値を照合する。
自分の書き込みを無視する既存 watcher の更新を待たない。git diff は証跡に残し、
保存の判定は対象 transform の値の変化で行う。

AFTER の各手順前に、タイムラインの全体パンくずでフォーカスを出てプレビューを再構築する。
手順8・10では `data-akari-tree-toggle` ボタンを実クリックして outer / g1 を展開し、
操作と前後の状態を `observations.preparation` へ記録する。これは検証の前準備であり、
製品側のプレビュー選択が畳まれた行を自動展開できるという判定には使わない。
