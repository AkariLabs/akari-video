---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-17
---

# transcript-monaco-v0 L1 検証手法・証跡

タスク: `2026-07-17-transcript-monaco-v0`。Monaco トランスクリプトパネル（captions.json 読み書き層 +
`akari-transcript` 拡張）の実機検証記録。

## 手法

`akari-preview` の S12 e2e 手法（`../../akari-preview/docs/e2e-method/README.md`）と異なり、
本パネルは Theia の `WebviewWidget`（二重 iframe）を使わず、メインレンダラー内に直接
`monaco.editor.create()` した `BaseWidget` である。そのため**入れ子 webview フレームへの
到達は不要**で、メインページのターゲットへ生 CDP（Chrome DevTools Protocol）で接続するだけで
実 DOM 状態・実イベントに到達できる。

1. `apps/shell` を `npm run build`（`build:ext` + `theia build --mode production`）でビルド
2. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir> --no-sandbox`
   で直接起動（`verify` スキル L1 節の手順どおり）
3. `/json/list` からメインページターゲットを取得し、生 WebSocket で CDP 接続
4. 実 UI 操作のみを使う: `Input.dispatchKeyEvent`（F1 でコマンドパレットを開く）→
   `Input.insertText`（コマンド名入力・字幕テキスト入力）→ `Input.dispatchMouseEvent`
   （生成ボタン・行のクリック）。DI コンテナ経由のサービス直呼び出しはしていない
   （本パネルはメインページ直結のため、その必要が無かった）
5. 観測は実ファイル（`project/captions.json` / `project/edit.json`）の実読み取りと、
   隔離ワークスペースを実際に git 管理下に置いての**実 `git diff`**で行った
   （`akari-project` 拡張が `.akari/workflow.json` を検知して自動で git init する挙動に相乗り）

## フィクスチャ

- **規模フィクスチャ**（62 分素材相当のスケールチェック用）: 合成 `analysis.json`
  transcript 300 セグメント・600 秒相当
- **小規模フィクスチャ**（1 画面に全行が収まりスクロール不要。デコレーション・編集・
  file-watch・hover・シークの各チェック用）: 20 セグメント・39.6 秒相当。
  `edit.json.cuts` を `[0,8]` と `[32,40]` の 2 keep-range に設定し、
  中間（segment 4〜15・12 行）をカット済みにした

いずれも ffmpeg (`testsrc` + `sine`) で生成した無音配信不要の小さい mp4 を伴う
（実データではなく合成データ。fieldtest 相当の実データはこのワークスペースには
見当たらなかった）。検証後、隔離ワークスペース・生成素材は完全に削除しコミットしていない。

## 実測結果の要旨（詳細は `run-log.json`）

| 項目 | 結果 |
|---|---|
| 初回生成（300 セグメント） | id `c-0001`〜`c-0300` 連番・1 要素 1 行・キー順固定を確認 |
| カット済みデコレーション | 期待 12 行（segment 4〜15）に対し実測 12 行のグレー+打ち消し。一致 |
| デコレーションの file-watch 追従 | アプリ外から `edit.json.cuts` を書き換え → アプリ再起動なしでカット表示が 0 件に追従 |
| 1 行編集 → 差分 | 実際の行クリック→選択→入力→保存 → **実 `git diff` が captions.json の当該 1 行のみ**を表示（無関係行 diff ゼロ）。`start`/`end` 不変・`edited:false→true` |
| `edited:true` の再生成保護 | 編集後に「文字起こしから更新」を再実行 → 再生成後の `git diff` が空（編集行・未編集行とも byte 単位で不変） |
| hover タイムスタンプ | `開始: 00:00:18.000 終了: 00:00:19.600`（segment 9 の実測値と一致） |
| クリック→シーク（劣化） | フッターに `00:00:18.000 を選択しました。プレビュー連携は未対応です。` を表示。`akari-preview` は改修せず、`AkariTranscriptSeekService`（DI シングルトン Emitter）でコマンド `akari.transcript.seekRequested` を発火するのみ |
| 開く導線 | コマンドパレット（F1）→「文字起こしを開く」→ Enter でパネルが開くことを実 UI 操作で確認。`.analysis.json` への `OpenHandler`（`canHandle` 優先度 1200）も同じ `open()` を共有するが、`.analysis.json` は既存の `sidecarSuffixes` ポリシーにより通常モードのツリーで非表示のため、本ラウンドではツリーのダブルクリック経路は別途検証していない |
| 行数不一致ガード（行追加・削除・分割） | ソースコード確認（`onEditorChanged` の行数比較ガード）+ 単体テストで確認。実機での Enter キー再現は CDP クリックがエディタの編集可能領域に正しく乗らず未達（フォーカス起因の検証手法側の課題であり、プロダクトコードの疑義ではない） |
| L0（`npm run build:ext` / `npm run lint`） | いずれも exit 0 |

## 補足: caption-store.ts の単体テスト

実機起動とは別に、`apps/shell/extensions/akari-transcript/lib/browser/caption-store.js`
（`tsc` コンパイル済み）を node で直接 require し、合成 500 セグメントの analysis.json で
`regenerateCaptions` / `replaceCaptionLine` / `parseCaptions` を検証した。結果は
`run-log.json` の `l1.unitTests` を参照。書き戻し実装（`replaceCaptionLine`）が
正規表現による対象行のみの文字列置換であり、`JSON.parse`→`stringify` の配列全体書き出しを
行っていないことはソースコード（`caption-store.ts`）でも確認済み。
