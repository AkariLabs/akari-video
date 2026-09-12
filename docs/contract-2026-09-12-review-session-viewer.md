---
lifecycle: draft
created: 2026-09-12
updated: 2026-09-12
---

# レビューセッション見返しビューア契約

- 日付: 2026-09-12
- 状態: draft
- 前提: `contract-2026-08-11-review-session-ui-events.md`、
  `contract-2026-08-23-stroke-persistence.md`
- スコープ: 録音時計 `recT` を基準にした音声・出力プレビュー・描線・文字起こしの同期表示と、
  録音時点の `edit.snapshot.json` と現在の `edit.json` の差分表示

## 0. 版と互換

本機能は `review/sessions/s-NNNN/` の原本の形を変えず、すべて読むだけで扱う。欠けたファイル、
壊れた行、未知フィールドは警告または情報なしへ縮退させ、既知の残りを表示する寛容リーダーとする。
記録原本、manifest、edit.json の migration や書き戻しは行わない。

## 1. `readReviewSessionBundle` 読み出し口

入力は次のとおり。

| フィールド | 型 | 意味 |
|---|---|---|
| `projectRootUri` | `string` | ワークスペース内のプロジェクトルート URI |
| `sessionId` | `string` | `s-NNNN` 形式のセッション ID |

出力は次のとおり。

| フィールド | 型 | 意味 |
|---|---|---|
| `sessionId` | `string` | 読み出したセッション ID |
| `audioUri` | `string \| null` | `audio.wav` の file URI。欠落時は `null` |
| `audioDurationSec` | `number` | WAV ヘッダから得た録音尺。読めなければ `0` |
| `events` | `ReviewSessionEvent[]` | 有効行を `recT` 昇順で安定ソートしたイベント |
| `strokes` | `ReviewStroke[]` | 既存の寛容な strokes リーダーが返す描線 |
| `transcript` | `ReviewSessionTranscriptSegment[] \| null` | 発話列。未コンパイル時は `null` |
| `proposals` | `ReviewSessionProposalSummary[] \| null` | 対象解決の表示用要約。欠落時は `null` |
| `editSnapshotText` | `string \| null` | 8 MiB 以下の snapshot 生テキスト |
| `warnings` | `string[]` | 読み飛ばした原本・行の説明 |

入口の不正 ID、ワークスペース外、セッションディレクトリ不在だけは例外とする。それ以外の欠落・
破損は残りを返し、原本へ書き込まない。

## 2. `recT` から `timelineT` への写像

状態は `{playing, anchorTimelineT, anchorRecT, rate}` とし、位置を次で求める。

`playing ? anchorTimelineT + (recT - anchorRecT) * rate : anchorTimelineT`

| イベント | anchor と状態の更新 |
|---|---|
| `start` | `timelineT` / `recT` を anchor、`playing` を記録値、`rate=1` |
| `play` | 先に現位置を求め、有効な `timelineT` または現位置を anchor、`playing=true` |
| `pause` | 有効な `timelineT` または現位置を anchor、`playing=false` |
| `seek` | `to` を timeline anchor、イベント `recT` を rec anchor にする |
| `rate` | 先に現位置を anchor にし、正の `value` を rate にする |
| `tick` | イベント `timelineT` / `recT` で anchor を打ち直す |
| `end` | 有効な `timelineT` または現位置を anchor、`playing=false` |

この意味論は `compile-review-session` の時刻写像と同一である。ビューアは `audio.currentTime` を
`recT` の正本とし、出力プレビューへの seek は既存の requestAnimationFrame 経路で間引く。

## 3. 描線の再表示

描線の寿命と薄れ方は `contract-2026-08-23-stroke-persistence.md` および
`PEN_TUNING.visibleWindowSec` を正本とする。ビューアはセッションの描線をプレビューへ attach し、
録音プレイヘッドを動かし、閉じると detach するだけである。描画規則や原本は変更しない。

## 4. 文字起こしと対象表示

`transcript.json` があれば発話単位で並べ、現在の `recT` に該当する発話を強調する。発話クリックは
その開始 `recT` へシークする。`compile-proposals.json` は発話と同じ index で突き合わせ、
`target`、`sourceT`、low confidence の要確認表示を添える。本票は人間が解決結果を目視確認する
表示のみで、対象を修正する UI は次段とする。未コンパイル時の導線は定型文をコピーするだけで、
compile 自体を実行しない。

## 5. `edit.snapshot.json` との差分

両文書を `readInternalEdit` で読み、全 track の item と再帰的な children を ID で突き合わせる。
表示する変化は追加、削除、`at` の移動、`duration` の尺変更、media source の `in/out` の素材区間変更の
5 種である。1 item に複数の変化があれば別々に表示する。v0 / v1 snapshot は「旧形式のため差分を
出せない」と明示し、migrate しない。

## 6. 映像

映像面には現在の `edit.json` の出力プレビューを使う。当時の素材や映像を探索・復元しない。

## 7. 非目標

- audio、events、strokes、snapshot、transcript、proposals の書き換え
- compile の実行や文字起こし生成
- compile の対象解決や注釈内容の編集
- 当時の映像・素材の復元
