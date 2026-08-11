---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-12
---

# annotation-asset-catalog-id L1 検証手法・証跡

タスク: `2026-08-12-annotation-asset-catalog-id`（カタログ由来素材カードへの
`asset:<catalog-id>` 付与）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は
`catalog-tab`（2026-07-25）と同じ共有ヘルパー（DEFAULT_TIMEOUT_MS のみ
15s→45s に変更。理由は同ファイル冒頭のコメント参照 — 検証実施時、同一
マシン上の並列レーン負荷で load average が 90〜130 に達し、既定 15s では
正常な CDP 応答すら timeout することを実測したため）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. 隔離ワークスペース（リポ外 `/tmp`）に `templates/project-default/` をコピーし、
   ffmpeg 生成の実 12 秒動画（`testsrc` + `sine`）を `assets/sample.mp4` へ、
   1 カット構成の `edit.json` を `exports/edit.json` へ配置（`source.path` は
   edit.json 自身のディレクトリからの相対パス — 実機で `ENOENT` を実測して確認した仕様）
3. カタログはワークスペース非依存の実配置 `catalog/`（このリポジトリの本物、
   fixture ではない）をそのまま使う。dev-layout 自動検出（`catalog-tab` タスクで
   確立済みの挙動）が効くよう、Electron 起動時の shell cwd をリポジトリルートに揃えた
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
   で直接起動（fake device フラグは録音セッションの `getUserMedia` 呼び出しを
   マイク権限プロンプト無しで通すため。M1 タスク実測の踏襲）
5. `run-l1.mjs` が実際に UI 操作として実行した手順:
   1. 素材パネルの `sample.mp4` カードを実クリックしてプレビューを開く
      （akari-preview 側の既存の受動アタッチ配線が `exports/edit.json` を発見し、
      `ReviewModel.location.editUri` を満たす — 本タスクの対象外の既存挙動）
   2. 右サイドの「注釈」タブを実クリックして前面へ出し、「録音開始」ボタンを実クリック
      （`ensureVisible(editUri)` が出力プレビューを自動で開き、実際に録音セッションが始まる）
   3. 左サイドの「＋ カタログから素材をさがす」ボタンを実クリックしてカタログ面へ切替
   4. `broll/laptop-typing-closeup`（実カタログの実在アイテム）のカードのタイトル
      テキスト部分を実クリック（「取り込む」「頼む」ボタンや取得状態バッジと重ならない
      カード内領域を狙って安全に本体の `data-akari-ui` へ当てる）
   5. 「注釈」タブを再度前面へ出し「録音終了」ボタンを実クリックして録音を止める
   6. `review/sessions/s-0001/events.jsonl` を実ファイルとして読み、
      `{"type":"ui.click","target":"asset:broll/laptop-typing-closeup", ...}` 相当の行を確認
6. 後片付け: 各回 `ps aux` で本 worktree の `apps/shell` パスを含む Electron 系
   プロセス（main / Helper / Helper (Renderer) / plugin-host / GPU 等）の残存ゼロを
   確認してから次を起動（`kill -9` 単体では `plugin-host` 等が孤児化することを
   実地で確認 — `catalog-tab` README と同じ教訓）

## 実測結果

### L0（単体テスト・静的検査）

```
$ cd apps/shell && npm run build:ext
Found cached ffmpeg library. Hashes are equal, not replacing.
tsc -b ... → エラー 0 件

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)   ← 全て本タスク以前からの既存 warning
                                          （akari-preview-open-handler.ts の
                                          LayerPerspective 未使用 import、
                                          akari-preview-service.ts の
                                          readdir/rm/symlink/writeFile 未使用 import。
                                          いずれも本タスクで触っていない箇所）

$ cd extensions/akari-project && npm test
ℹ tests 174
ℹ pass 174
ℹ fail 0

$ cd ../akari-preview && npm test
ℹ tests 202
ℹ pass 202
ℹ fail 0

$ cd ../akari-annotations && npm test
ℹ tests 136
ℹ pass 136
ℹ fail 0
```

合計 512 件、全件 PASS。3 拡張とも 0 failure（akari-project の 174 件中 2 件が本タスクの
新規テスト `catalogCardUiEventTarget` の still/audio ケース）。

### L1（実機・生 CDP）

`run-l1.mjs` 最終実行の実測ログ全文は `run-log.json`。要旨:

| # | 項目 | 結果 |
|---|---|---|
| 起動 | Electron 実機起動 → activity bar 描画完了 | `00-boot.png` |
| 素材クリック | `sample.mp4` カードクリックで `location.editUri` が解決し「録音開始」ボタンが有効化 | `01-materials-tab.png` / `02-review-panel.png` |
| 録音開始 | 「録音開始」実クリックで実際に録音セッションが始まる（`録音開始`→`録音終了` にボタン文言が変化） | `03-recording-active.png`（画面全体をオレンジの枠が囲む記録中インジケータも表示。注釈パネル領域だけ枠なし） |
| カタログカードのクリック | `broll/laptop-typing-closeup` カードのタイトルを実クリック | `04-catalog-card-clicked.png` |
| 録音終了 | 「録音終了」実クリックでセッションが閉じる | `05-recording-stopped.png` |
| **events.jsonl 実測** | `review/sessions/s-0001/events.jsonl` に `{"recT":5.6335,"type":"ui.click","target":"asset:broll/laptop-typing-closeup","label":"ノート PC タイピング クローズアップ"}` が記録される | `events-s-0001.jsonl`（全文） |
| console error | 録音開始前後で `window.__errCount` の差分 0 | `run-log.json` の `console-error-delta` |

`events-s-0001.jsonl` 全文:
```
{"recT":0,"type":"start","timelineT":0,"playing":false}
{"recT":2.4337000000178812,"type":"ui.panel","target":"panel:assets","label":"素材パネル"}
{"recT":5.6335,"type":"ui.click","target":"asset:broll/laptop-typing-closeup","label":"ノート PC タイピング クローズアップ"}
{"recT":9.37509999999404,"type":"ui.panel","target":"panel:review","label":"注釈パネル"}
{"recT":10.00940000000596,"type":"end","timelineT":0}
```

契約の期待形 `{"type":"ui.click","target":"asset:<category>/<id>","label":"<カード表示名>"}`
と一致（`<category>/<id>` = `broll/laptop-typing-closeup`、label = カードの表示名）。

### 非記録中の回帰確認

`events.jsonl` の行数は録音終了後は変化しない（`end` 行が最後で追記が止まる —
`review-session-recorder.ts` の capture-phase リスナーが `stop()` で外れる既存配線どおり。
本タスクでは `akari-preview`/`akari-annotations` を一切編集していないため、この挙動自体は
不変条件として実測確認のみ行った）。

## 検証中に踏んだ実地の教訓（次の人のために記録）

- **`AkariRoleBucketsWidget` の左パネルは 2026-07-25 の `catalog-tab` 検証時から
  UI が変わっている**: 当時の `role="tab"` 3本立て（素材/カタログ/プラン）は無くなり、
  現行は素材ペイン既定 + `[data-akari-open-catalog]`（＋カタログから素材をさがす）/
  `[data-akari-back-to-materials]`（← 素材にもどる）の1枚差し替え方式になっていた。
  古い評価スクリプトのタブ切替ヘルパーをそのまま使い回すと空振りする
- **右サイドの「注釈」タブが不定期に別パネル（「パートナーを追加」等）へ勝手に
  切り替わる**ことを実機で複数回観測した（O3 初回導線の自動フォーカス誘導との
  競合と推測。未確認）。「タブを前面へ→即座に状態確認→即座にクリック」を短い間隔で
  やり直すリトライで安定した。長い `sleep` を間に挟むとその間に奪われることがある
- **録音開始・終了のボタン文言遷移（`録音開始`→`準備中…`→`録音終了`、
  `録音終了`→`保存中…`→`録音開始`）は数秒〜十数秒かかることがある**。
  「準備中…」「保存中…」の間に焦って再クリックすると二重トグルで即座に
  元へ戻ってしまう事故になるため、遷移中は絶対にクリックし直さない実装にした
- **edit.json の `source.path` は edit.json 自身のディレクトリからの相対パス**
  （ワークスペースルートからの相対ではない）。`exports/edit.json` から
  `assets/sample.mp4` を指すには `"../assets/sample.mp4"` が必要（`"assets/sample.mp4"`
  では `exports/assets/sample.mp4` を探しにいって `ENOENT` になることを実機の
  トースト文言で確認した）
- **同一マシン上の並列レーン負荷（本 wave は 3 レーン並列）で load average が
  90〜130 に達し**、CDP の既定 15s タイムアウトでは起動直後の `Runtime.evaluate` すら
  timeout することがあった。`cdp-lib.mjs` の `DEFAULT_TIMEOUT_MS` を 45s に緩めた
  （本ディレクトリの `cdp-lib.mjs` だけの差分。産物コード側の変更ではない）
