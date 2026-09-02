# 文字起こし未認識区間（`unrecognized[]`）契約 v0

- 日付: 2026-09-02
- lifecycle: accepted
- 対象: `analysis.json` の `transcript[]` と `captions.json` の字幕レコード

## 0. 位置づけ

`unrecognized[]` は、Vrew のインライン表示 `??` に対応する「音はあるが文字にできなかった区間」を記録する。
「あー」のように語へ起こせなかった声、息継ぎ、雑音、音楽などが対象であり、無音そのものは対象外である。
この契約はデータと検出・持ち越しだけを定め、`??` の表示や操作は T5b に委ねる。

## 1. データ模型

analysis.json の各 `transcript[]` セグメントと captions.json の各字幕レコードは、任意の兄弟配列
`unrecognized: [{ start, end }]` を持てる。`start` / `end` は非負の秒で、analysis では source 秒、
captions では当該レコードの `time_domain` と同じ時刻ドメイン（省略時は source 秒）に従う。

各配列は `start` 昇順、区間同士が非重複でなければならない。生成側は 0 長区間を出さず、
`words[]` のどの語区間とも重ねない。`words[]` は本文の認識語だけを保持し、未認識区間を混ぜない。

## 2. 検出規則

検出根拠は次の二つに限る。

1. whisper が明示した非発話マーカー（`[inaudible]`、`[音楽]`、`[拍手]`、
   `(unintelligible)` など）の時刻区間。`[BLANK_AUDIO]` と `[_BEG_]` / `[_TT_n]` / `[_SOT_]` /
   `[_EOT_]` / `[_TRANSCRIPT_]` などの制御マーカーは捨てる。
2. セグメント先頭・語間・末尾にある 0.45 秒以上の語の隙間から、ffmpeg `silencedetect` が検出した
   無音を引き、0.3 秒以上残った各区間。silencedetect の既定値は `noise=-35dB:d=0.2` とする。

根拠 1 は長さの閾値を適用せず、根拠 2 と重なれば結合する。境界はミリ秒へ丸める。同じ入力、語時刻、
無音区間、オプションからは常に同じ出力を得る。

## 3. captions.json への持ち越し

`fill-caption-words` は transcript セグメントの `unrecognized[]` を時間重なりで各字幕へ複製し、
字幕の `[start, end]` へ切り詰める。空ならキーを書かない。既存の非空 `unrecognized[]` は
`--force` 無しでは保持し、`words[]` の有無や上書き判定とは独立に扱う。

## 4. lint

schema と validator は配列、要素の exact keys、有限・非負の `start` / `end`、`start <= end`、昇順、
非重複を検査する。validator は字幕範囲外を許容する。edit-lint は同じ形の違反を
`captions.schema` error、字幕範囲外を `captions.unrecognized-range` warning、語区間との重なりを
`captions.unrecognized-overlaps-word` warning として報告する。

## 5. 消費側の約束

既存の `words[]` の形、`text` 非空の規律、「1 要素 = 本文の 1 語」という意味は変えない。
カラオケ描画、語再導出カーネル、既存プレビューは `unrecognized[]` を語として消費しない。
`??` のインライン表示、置換、カット、QC 連動は T5b の責務である。

## 6. 非スコープ

confidence、低確信の認識語を示すマーカー、未認識区間の自動置換・自動カットは本契約に含めない。
SpeechAnalyzer や cloud バックエンド固有の非発話マーカー解釈も追加せず、語間隙からの検出だけを共通適用する。

## 7. パネル側の約束（T5b）

台本パネルは各未認識区間を `??` 固定で時刻順に表示する。表示位置は `span.start >= words[i].end` を
満たす最後の語の直後とし、該当語が無ければ行頭、最後の語より後なら行末へ置く。`words[]` が無い行では
本文の末尾へ並べる。`??` は字幕語やカラオケの語 index には含めない。

聞き取った文字への置換は、`setCaptionFields` の `text` と `unrecognized` を 1 回の書き戻しで更新する。
本文では `??` の直前にある語の直後へ文字を挿入し、対象区間だけを `unrecognized[]` から除く。新しい語の
時刻は共通カーネル `rederiveCaptionWords` が前後の保持語の間へ配分し、既存の他語は変更しない。

映像ごとのカットは対象の `[start, end]` をパディングせず、`kind: 'unrecognized'` として
`applyCutRanges` へ渡す。カット成功後に対象区間を `unrecognized[]` から除き、字幕側の更新に失敗した場合は
カット前の edit.json を復元する。

文字起こしタブの再生成直列化器と edit-store の `insertCaptionLine` 直列化器は、どちらも非空の
`unrecognized[]` を保全する。再生成では `edited: true` の行と対応 segment が無い行の既存値をそのまま保ち、
`edited: false` の再生成行と新規行は analysis segment の区間を字幕の `[start, end]` へミリ秒単位で
切り詰め、時刻順に並べて隣接・重複区間を結合して持ち越す。空になった配列は書かない。

低確信の認識語を示すマーカー、1 個の `?`、および `???` の使い分けは T5b の非スコープとする。
