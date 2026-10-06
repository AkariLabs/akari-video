---
lifecycle: implemented
created: 2026-10-06
updated: 2026-10-06
---

# タイムラインの範囲操作と詰めカーネル v0

実装モジュールは `packages/edit-store/src/ripple.ts`。`cut-ranges.ts` はこのカーネルを呼び出す。edit.json v2 の時刻は整数フレーム。`tracks[]` の配列順は合成順として維持する。範囲編集関数は入力を変更せず `{ edit, changed, removedFrames?, blocked?, reason? }` を返す。`changed: false` では `reason` に操作不能の理由を入れる。`setTrackRippleMode` は新しい edit を直接返し、`findGapAt` と `editPoints` は読み取り値を返す。

## トラックの札

`tracks[]` に任意の `target` / `sync` 真偽値を保存する。`resolveTrackRippleMode(track)` は `target: true` を `cut`、`target: false, sync: true` を `shift`、`target: false` とそれ以外の組を `fixed` とする。両キー省略時は visual が `cut`、audio は 1 件以上の全アイテムが `role: "bgm"` なら `fixed`、それ以外は `cut`。`sync` だけ指定したときは true が `shift`、false が `fixed`。`setTrackRippleMode` は `cut = (true,true)`、`shift = (false,true)`、`fixed = (false,false)` を保存する。

操作ごとの `modeOverride` は一時指定で、`lockedTrackIds` は常に固定として優先する。固定トラックは範囲操作で変えない。選択アイテムを明示して消す場合はそのトラックを削除対象とするが、ロック中なら操作全体を拒否する。

| 関数 | 内容 |
|---|---|
| `splitAtFrame` | 再生ヘッドをまたぐ cut トラックの media / html / telop / filter / 独立音声を分割。`itemIds` または `trackIds` で絞れる。リンクした映像・音声は同時に分割する。リンク相手がロック行にある場合、または左右どちらかが `ceil(fps × 0.15)` フレーム未満なら、全体を拒否して `changed: false` と `reason: "リンク相手が固定中か、片側が最小尺未満です"` を返す。 |
| `liftRange` | cut トラックの範囲内を取り除き、隙間を残す。 |
| `extractRange` | cut トラックの範囲内を取り除き、後続を範囲長だけ前へ送る。shift トラックは中身を取り除かず、範囲終端以降に始まるアイテムだけを前へ送る。 |
| `rippleDeleteItems` | 選択アイテムの区間を詰める。他トラックは中身を消さずに後続を送る。リンク相手も既定で対象とし、`oneSide` で片側だけにできる。離れた選択は右から処理する。 |
| `findGapAt` / `closeGapAt` | 指定トラックでフレームを含む先頭またはアイテム間の隙間を見つけ、その長さだけ後続を送る。末尾の空きは対象外。 |
| `rippleTrimToPlayhead` | 最も近い前後の編集点から再生ヘッドまでを `extractRange` する。編集点が無ければ理由を返す。 |
| `editPoints` | cut トラックのアイテム端を昇順・重複なしで返す。 |
| `compactTrackGaps` | cut の visual トラックにある media だけを配列順に詰める。`fromItemId` があればそのアイテムの後続だけを詰める。既定では anchor 付きアイテムを直接動かさない。 |
| `applyCutRanges` | 素材秒で重なる media を選び、共通の区間除去部品で切除する。触った visual トラックの media だけを `at = 0` から配列順に詰める旧挙動を保つ。 |

shift は前のアイテムの終端より前に入らない。必要な移動量を確保できなかったアイテムの id を `blocked` に返し、重なりを作らない。`anchor` を持つアイテムは shift で直接動かさない。cut トラックなら範囲内の削除対象にはなる。位置の再解決は `refreshItemAnchors` の責務とする。`applyCutRanges` は旧挙動を維持するため、`compactTrackGaps` に `includeAnchored: true` を渡して触ったトラックの media を詰める。

分割片の `source.in/out` は、素材秒をアイテムのフレーム比率（speed 込み）で按分する。音声の `keyframes[].gain_db` と映像の数値キーフレームは境界点を両片に入れ、ローカルフレーム時刻へ振り分ける。境界値は区間の終点側キーの `easing` を `easingProgress` で評価する。文字列指定は全プロパティ、Record 指定はプロパティ別（例: `gain_db`、`opacity`、`transform.x`）に適用し、左片の新しい境界点にも終点側の easing を引き継ぐ。線形区間の全フレーム値は分割前と一致する。非線形区間は境界値を一致させるが、分割後の区間内部の曲線は近似になる。`fade_in` は左片、`fade_out` は右片だけに残し、ダッキングなど他の属性は両片へ複製する。リンク音声の右片は映像の右片へ `link` を付け替える。

字幕本文は `captions.json` のソース秒が正本であり、ここでは変更しない。切除後の表示位置は `timeline-map` の `sourceToOutput` で追従する。通常の Delete は隙間を残す。詰める処理は明示した操作でだけ行う。
