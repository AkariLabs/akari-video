# 仮枠クリップを動画にする

対象は 1 本の edit.json v2 item id で指定する。既定は 1 クリップずつ。最初に dry-run で正規化された入力、provider へ送る body、見積を確認する。

```sh
akari generate video <projectDir> --item <itemId> --dry-run --json
```

## 9 スロットを埋める

1. `prompt` / `negative_prompt`: 内容と動きを記述する。camera はアダプタが prompt へ合成する
2. `first_frame`: 省略時は対象クリップの静止画。任意入力として扱う
3. `last_frame`: `--last-frame`。非対応モデルへは送らず検証エラーにする
4. `reference_images[]`: `--reference-image`。本数上限は能力カタログに従う
5. `reference_videos[]`: 動きを真似る参照。v1 は CLI 表面に専用フラグを持たず、必要時は `--inputs <json>` で渡す
6. `reference_audios[]`: `--reference-audio`。必要範囲だけを `range_s` で切り出す
7. `source_video` + `mode`: 続ける・直す元。v1 は欄のみで、必要時は `--inputs <json>` を使う
8. `camera`: `--camera`。bracket / trajectory / prose のうちモデルに合う表記へアダプタが変換する
9. `seed`: 再現用の表示欄。決定論は保証しない。v1 は `--inputs <json>` で渡す

出力ノブは `--duration` `--resolution` `--audio-out`。`--model` と `--prompt` で既定を上書きできる。参照要素は path と sha256 を持ち、1 ファイル 20 MB 以下にする。

尺は対象 item の cuts から得る。モデルの許容値へ丸める場合は、要求尺、実際に送る値と型、丸め方向、差分を実行前に表示する。

## 費用承認

能力カタログの価格と `as_of` から見積もる。承認を求める会話では、[approvals-and-generation.md](../edit-plan/approvals-and-generation.md) の形式を次の 8 項目へ展開して示す。

```text
対象:
使う手:
理由:
代替案と得失:
見積費用（通貨・計算根拠・as_of）:
待ち時間:
外部送信:
実行後に残す provenance:
```

価格が無いモデルは「見積不可」と理由を示し、明示確認を待つ。複数対象をまとめる場合は item ごとの金額と合計金額を示して 1 回の費用承認を得る。承認後だけ `--yes` を付ける。

```sh
akari generate video <projectDir> --item <itemId> --model <modelId> --prompt <prompt> --last-frame <path> --reference-image <path> --reference-audio <path> --camera <value> --duration <seconds> --resolution <value> --audio-out --inputs <json> --yes --json
```

## 差し替え

完了時は同じ item の `sources[].path` だけを mp4 へ差し替える。item id・トラック・`at`・タイムライン総尺は変えない。

- 実尺が cuts 以上: cuts の長さで末尾を切る
- 実尺が cuts 未満: 実尺まで再生し、`freeze` で不足分の最終コマを止める
- 生成動画に音声があっても `mute: true` が既定。ナレーションと BGM を正とし、必要なら人間が解除する

差し替えだけを undo の 1 手にする。状態更新や履歴追記は undo に含めない。
