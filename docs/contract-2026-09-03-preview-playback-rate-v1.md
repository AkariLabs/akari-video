---
lifecycle: accepted
created: 2026-09-03
updated: 2026-09-03
---

# プレビュー再生速度・ピッチ保持契約 v1

## 1. UI と状態

プレビューのトランスポート右側は pen → rate → zoom → fullscreen の順とする。rate ボタンは
アイコンではなく現在値を `0.5×` の形式で表示し、ポップアップから
`0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 3` の 7 値を選ぶ。値域は 0.5 以上 3 以下である。
スライダーとキーボードショートカットは設けない。

速度の正本は webview の `previewRate` とする。変更値は host の当該 preview widget にだけ保持し、
インスペクター編集による incremental 更新と webview 再構築を跨いで復元する。ディスク、Theia
preferences、edit.json には保存せず、widget を閉じた後の新しいプレビューは 1× から始める。
raw 素材プレビューにも同じ UI と速度を適用する。

## 2. `rate` の意味

`previewRate` は「出力タイムライン秒 / 実時間秒」である。`playbackTick.rate` とレビューセッションの
`reviewTransport` に記録する `type: "rate"` の `value` は、どちらもこの値を送る。legacy の cut に
宣言された `segment.speed` は素材秒と出力秒の写像であり、レビューの rate イベントには送らない。
従来の segment speed 変更イベントは廃止する。

frame-engine の時計は経過実時間へ `previewRate` を掛ける。legacy の動画要素は
`segment.speed × previewRate` で再生し、gap と静止画は壁時計へ `previewRate` を掛ける。
freeze の実時間ホールドは宣言秒を `previewRate` で割る。速度変更時は現在位置に錨を打ち直し、
再生ヘッドを飛ばさない。

## 3. 音声とピッチ保持

frame-engine 経路では全音源を `PreviewAudioSupply` の master gain に集め、音源の予定時刻と
AudioContext 時計を `previewRate` で進める。legacy 経路でも previewAudio の BGM・SFX・ナレーションを
同じ倍率で再予定する。legacy の動画要素（台詞を含む）は `preservesPitch = true` を明示する。

1× は master gain から destination への直結である。1× 以外は共通の
`preview-audio-worklet.js` と `akari-pitch-shift` processor を使い、速度 r で再生した全音声へ
ratio `1 / r` のピッチ補正を掛ける。worklet の準備前は速度だけを先に反映し、準備完了後に経路へ
差し込む。読み込み失敗または AudioWorklet 非対応時も再生を止めず、警告を 1 行出して素の速度へ
フォールバックする。

frame-engine の `debug()` は `rate`、`pitchPreserved`、`stretcher` を返す。`stretcher` は
`"worklet" | "none"`、`pitchPreserved` は 1× または worklet が実際の経路に入った場合だけ true とする。
`attachAnalyser()` は master bus 出口へ AnalyserNode を一つだけ接続し、検収用の tap として返す。

## 4. 非目標

本機能はプレビュー専用である。書き出しの速度・音声処理には影響せず、edit.json の内容も変えない。
速度の preferences 永続化、キーボードショートカット、速度スライダーは本契約の対象外とする。
