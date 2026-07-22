# 試聴ギャラリー（keep / drop）

[drop-folder.md](drop-folder.md) で登録された音源を、実際に聴きながら keep/drop を
決めるためのローカルギャラリー。decision-cards / intake-form と同じ流儀（`127.0.0.1`
のみ・外部 npm 依存ゼロ・状態は JSON サイドカーへ atomic 書き込み）。

## 1. 起動する

```sh
node packages/audio-library-setup/bin/gallery-helper.mjs \
  --library-root ~/.akari-video/assets/audio
```

起動すると `HELPER: http://localhost:<port>/` を標準出力に出す。ユーザーへそのまま
提示し、ブラウザで開いてもらう。

## 2. 画面で分かること

- `~/.akari-video/assets/audio/<id>/meta.json` を持つ登録済みエントリを一覧表示する
  （`meta.json` はあるが再生可能な音声実体が無いエントリは表示しない）
- 各エントリの音声ファイルを `<audio controls>` でその場再生できる
  （`/media/<id>/<filename>` 経由でのみ配信。ライブラリ外のファイルは配信しない）
- ライセンスバッジ（要クレジット／クレジット不要／AI学習禁止）に加え、`meta.json` に
  `mood[]` / `tempo` があればそれもバッジ表示する（2026-07-22 tasks/audio-fetch-gallery で追加）
- 画面上部の入力欄で id / タイトルを絞り込み検索できる
- 「keep 一覧をコピー」ボタンで、現在 keep 判定済みの id を JSON 配列としてクリップボードへ
  コピーできる（オーナーがフィードバックとして他ツールへ貼り付ける用途）
- keep / drop ボタンで決定を記録する。決定は `~/.akari-video/assets/audio/_gallery-state.json`
  へ即時保存される（ページを閉じても消えない）。もう一度同じボタンを押すと決定を解除する

## 3. keep / drop の扱い

このスキルは keep/drop の**記録**までを行う。`drop` にした素材の実ファイル削除や、
`assets/audio/INDEX.md` への反映は別途人間の判断で行う（自動削除しない。取り違えた
決定を戻せなくする操作を勝手に実行しない）。

## よくある間違い

- ギャラリーサーバを `0.0.0.0` 等、ローカル以外にバインドする。
- `_gallery-state.json` を手で編集して整合性を崩す（サーバ経由の atomic 書き込みに
  一本化する）。
- keep/drop の記録だけで「ライブラリ整理が完了した」と報告する（実ファイルの削除・
  INDEX 反映は別工程）。
