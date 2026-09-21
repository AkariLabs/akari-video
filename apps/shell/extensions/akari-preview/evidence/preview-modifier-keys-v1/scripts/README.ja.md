[English](./README.md) | **日本語**

# プレビューの Esc・修飾キー L1

P0 部品文字編集・P1 階層選択の CDP 接続、隔離 Electron 起動、プレビュー再構築、実入力の道具を流用する。構文確認では Electron を起動しない。

前提: ビルド済み `apps/shell`、Electron 実体、WebSocket 対応 Node、ffmpeg、Git。ビルドと実行はラッパーが担当する。ブラウザ自動化用の依存追加は不要。fixture は `templates/project-default` と HTML 袋の fixture を新規一時プロジェクトへ複製し、PNG 素材 2 枚・字幕 2 件を加える。リセット用のコミットは一時プロジェクト内だけで行う。既存プロジェクトの上書きは拒否する。

```sh
# リポジトリルートから、ビルド後にラッパーが実行する。
AKARI_CDP_PORT=9757 bash apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.sh after
```

Electron が既定のルート node_modules と異なる場所にある場合は `ELECTRON_BIN` を指定する。ランチャーはポートの空きを確認し、ユーザーデータ・設定を隔離して起動、最大 600 秒の起動待ち後に検証する。終了時は自分が起動した PID と一時ディレクトリだけを片付ける。

`../run-log.json` に次の 8 手順を記録する。

1. 通常 HTML と名札付き部品をダブルクリック→文字置換→Esc。元の表示、書き込み 0 回、選択維持、edit.json・HTML・captions の SHA-256 不変。
2. 同じ操作を Enter で確定。通常断片と部品の `source.text` が保存され、再構築後にも表示される。
3. 字幕の Esc は書き込み 0 回・ファイル不変、Enter は保存・再構築後の表示を確認。
4. overlay を左端付近へ移動し、同じドラッグ内で修飾キーを 0→Alt→Shift→Alt→0 と切り替える。
5. native layer でも同じ移動・修飾キー切り替え。
6. layer 回転中に Shift を押す→離す→押す。ライブ角度と保存角度が 15° の倍数になることを確認。
7. 字幕の pointerdown 時 Alt が既存の全字幕 `groupPosition` 経路を維持。全体既定位置が変わり、2 件とも同じ位置に出る。
8. 150% ズームで選択済み native layer 操作面から Alt+ドラッグし、プレビューがパンする。オブジェクト書き込み・ファイル変化はない。

ジェスチャーは CDP `Input.dispatchMouseEvent` による実入力。各 pointermove に modifiers（Alt=1、Shift=8）を明示し、キーボード状態だけで代用しない。文字入力は `Input.dispatchKeyEvent` と `Input.insertText`。準備のシーク・ズームには既存 input ハンドラを使う。観測ラッパーは engine メソッドをそのまま委譲し、実応答を記録する。書き込みの捏造はしない。各手順は fixture の初期状態から開始する。失敗・未到達も含め常に 8 レコードを残し、失敗があれば exit 1。到達した手順のスクリーンショットも保存する。

P1 回帰はラッパーが別途実行する。

```sh
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh after
```

P1 の変更は文字編集中 Esc の期待値「確定→キャンセル」だけで、ほかの手順は変更しない。

Electron を起動しない構文確認:

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.sh
```
