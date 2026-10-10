# akari-chat-review — L1 検証スクリプト

プレビューのペン / ピン / 範囲 → 「添付 N」 → `akari.chat.attach` を、production ビルドの
Electron + CDP + 実 DOM で確かめる。

```sh
cd apps/shell && npm run build
cd ../.. && AKARI_L1_OUT=<リポの外の出力先> node apps/shell/extensions/akari-preview/evidence/akari-chat-review/run-l1.mjs
```

- 一時ディレクトリ（ホームの外）に HOME / TMPDIR / プロファイル / プロジェクトを作って隔離する。
  プロジェクトはテンプレート + ffmpeg 合成素材 + `captions.json` の字幕 1 件 + `exports/draft-v1.mp4`
- 確かめること: 道具の十字カーソルと案内・Esc、ペンでテロップを囲むと「ここにあるもの」にテロップの文字、
  離れたピンにはテロップを出さない、ペン / ピン / 範囲で「添付 3」、シークバーの点・時刻が離れた印は薄い、
  膨らむ一覧（JPEG・幅 160 のコマ）と ×、`.akari/review/pending.json`、アプリを落として開き直しても残る、
  チャット拡張が無い構成の「AKARI チャットを開いてください」、書き出し動画のプレビューでもペン / ピン
- `akari.chat.attach` は**このスクリプトの中だけ**で検証用に登録し、渡された引数（`{ attachments }`）を記録する
- 結果 JSON とスクリーンショットは `AKARI_L1_OUT` に出す。リポにはコミットしない
