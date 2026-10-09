# caption-motion-playback — 字幕の動きが再生中に効くかの実機確認

インスペクターの「動き」タブで選べる字幕の動き（組・登場・強調・退場・テキストアニメ全種。タイプライターは除く）が、
**再生中に**プレビューと書き出しで効くかを撮るスクリプト。押した瞬間の replay ではなく、再生（0.5 倍速）しながら撮る。

## 使い方

```bash
# 先に apps/shell を build しておく（Electron は node_modules/electron/dist を使う）
node evidence/caption-motion-playback/run-l1.mjs --phase preview --label after --out <出力先>
node evidence/caption-motion-playback/run-l1.mjs --phase export  --label after --out <出力先>
```

- `preview`: 動き 1 種につき字幕 1 本（6 秒枠・字幕 5.5 秒・登場/退場の尺 2 秒）を並べた一時プロジェクトを開き、
  先頭から再生して各字幕の「登場の途中 / 表示中 / 退場の途中」を撮る。プレートの計算済み opacity / transform / clip-path も記録する。
  続けて、字幕を選択したまま再生する組と、インスペクターの選択表示（組「シンプル」→ 登場をスライド → 退場タブ →
  テキストアニメ「フェード」→ 退場をワイプ）の各段階のスクリーンショット・aria-pressed・保存内容を撮る
- `export`: 同じプロジェクトを `render-cut --engine auto` で書き出し（`AKARI_EXPORT_ALLOW_DESKTOP=0` で worktree の Electron を使う）、
  同じ時刻のフレームを抜く。レシートの `launcher_tier` も記録する
- `HOME` / `AKARI_HOME` / Theia の設定とプロファイルはすべて一時ディレクトリ。終了時に消す
- `--rows <key,...>` で行を絞れる（試走用）

## 修正前に見つかったこと（このスクリプトで確認）

1. 字幕が選択されていると、再生中も全ての動きが止まる（選択中のプレートに `animation: none !important` が当たっていた）。
   インスペクターで動きを選ぶ = その字幕が選択中なので、押した瞬間の replay だけ動いて再生では効かなかった
2. ワイプ・プッシュの `clip-path: inset(%)` が出力幅いっぱいのプレートに対して効いていたため、中央の短い文字は
   途中まで全く欠けず、画面上はワイプが見えなかった（書き出しも同じ）
3. テキストアニメ欄のカードはタブと無関係に固定の段（大半が登場）へ書き込み・選択表示していた
