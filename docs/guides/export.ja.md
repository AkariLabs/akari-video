[English](./export.md) | **日本語**

# 書き出す

承認済みの `edit.json` から最終 MP4 をレンダリングします。スキルは `render-cut`。

## 前提

- `edit.json` が確定していること
- [edit-lint](./review-and-fix.ja.md) が PASS していること（`.akari/lint.json` の
  `verdict: pass` を render-cut が確認します）

## 頼み方

「書き出して」「納品用に MP4 にして」

## 流れ — 承認してから走る

1. **validate** — 入力の妥当性確認
2. **plan** — 何をどうレンダリングするかの計画を提示（予測尺・処理内容）
3. **承認** — 人間が OK を出す（ここが 2 つ目のチェックポイント）
4. **render** — ローカルで ffmpeg レンダリング。映像は原本からカット・エンコード、
   表現（テロップ・字幕）はプレビューと同一の HTML をフレーム毎キャプチャで合成
5. **verify** — ffprobe で容器を検査し、宣言と出力の実測（音量・カメラワーク）を照合

## 生成されるもの

| ファイル | 内容 |
|---|---|
| `exports/<name>.mp4` | 最終出力 |
| `.akari/render.json` | 書き出し計画・実行結果の正本（コマンド列・provenance） |
| `.akari/reports/render-report.html` | 人間向けレポート（検証結果込み) |

## プレビューと出力が一致する理由

プレビューはプロキシ + ライブ DOM（即時・触れる）、書き出しは原本 + フレーム毎
キャプチャ（フレーム正確）。**同じ HTML・同じセーブデータ**を両方に通すので、
見ていたものがそのまま出てきます。

## うまくいかないとき

- **lint FAIL で始まらない** → [QA・レビューして直す](./review-and-fix.ja.md)。
  FAIL 理由はレポートに件数付きで出ます
- **verify FAIL** → レポートの stderr 要約を確認。「render の失敗を調べて」で診断まで頼めます
- **`verify.audio-level` FAIL** → 宣言した音声が全サンプル区間で無音、または音量を測定不能。
  宣言した BGM / SFX / narration / 素材音声とレポートを確認します

## 次のステップ

- よくできた成果物を次回のために保存 → [素材ライブラリを育てる](./asset-library.ja.md)
