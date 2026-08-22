# evidence: caption-subrow-output-space

T1（字幕トラック）の字幕帯が重なって描かれる症状の実測記録。
**段割りが source 時間・描画が output 時間**という時間軸の食い違いを、
段割りを描画と同じ output 区間へ寄せて解消した。

## 実装の裁定（2026-08-22）

1. **段割りと描画は同じ 1 本の純関数から取る**: `src/common/caption-subrow-layout.ts` の
   `computeCaptionSubrowLayout()` が「`MINIMUM_ITEM_DURATION` で伸ばした source 区間
   → `sourceRangeToOutputRanges()` で output 区間へ変換 → 実際に描く連続帯 → 段」を
   一度に返す。ウィジェットは戻り値の `start` / `end` / `row` をそのまま描画に使うので、
   段割りと描画が再び別の数字を見ることが構造的に起きない。
2. **捨てる判断を 1 箇所へ寄せた**: output 区間を 1 つも持たない（削除区間へ完全に落ちた）
   字幕は純関数の戻り値に**含めない**。結果は `Map<captionId, layout>` で返し、描画側は
   `this.captions` の配列 index ではなく**字幕 ID** で引く。これで非表示字幕の有無によって
   残りの字幕の段がずれることが起きない。
3. **複数 output 区間に割れる字幕**（削除区間を跨ぐ）は、現行の描画契約どおり
   **最初の開始から最後の終了までを 1 本の帯**として扱う（分割しない）。段割りにも同じ
   連続帯を渡す。分割すると 1 字幕に複数のドラッグ対象ができ、選択・移動・トリムの
   意味論を決め直す必要があるため、本タスクでは単一の操作対象を維持した。
4. **「別トラックへ置く」までは踏み込まない**（契約の既定どおり）。字幕の正本は
   captions.json のままで、`content` 型トラックは器のまま。射影は焼いていない。

## fixture

`fixture/` を `templates/project-default/` の複製へ重ねて使う（実素材 `assets/source.mp4` は
`ffmpeg -f lavfi` で 14 秒ぶん生成し、検証後に破棄・コミットしない）。

**cuts（`tracks[0] = v1`、fps 30）** — クリップの並べ替え + 中抜きを含む:

| id | at(frame) | duration(frame) | source 秒 | output 秒 |
|---|---|---|---|---|
| c1 | 0 | 60 | 0 – 2 | 0 – 2 |
| c2 | 60 | 60 | 10 – 12 | 2 – 4 |
| c3 | 120 | 60 | 2 – 4 | 4 – 6 |

→ 削除区間は source `[4, 10)` と `[12, 14]`。source の並びと output の並びは一致しない。

**captions（`fixture/captions.json`）**:

| id | source 秒 | output 帯（実測） | ねらい |
|---|---|---|---|
| cap-tiny-1 | 0.20 – 0.24 | 0.20 – 0.35 | `MINIMUM_ITEM_DURATION`(0.15s) 未満の連続字幕。 |
| cap-tiny-2 | 0.26 – 0.30 | 0.26 – 0.41 | source では重ならないが伸長後の output で重なる |
| cap-tiny-3 | 0.32 – 0.36 | 0.32 – 0.47 | 〃（3 本で 3 段必要） |
| cap-span | 1.00 – 3.00 | 1.00 – 5.00 | 削除区間を跨ぎ 2 つの output 区間へ割れる字幕 |
| cap-edge-1 | 3.90 – 3.94 | 5.90 – 6.00 | 伸長ぶんがセグメント終端で切り詰められる極短字幕 |
| cap-edge-2 | 3.96 – 3.98 | 5.96 – 6.00 | 〃 |
| cap-dropped-mid | 4.30 – 6.00 | （削除区間へ完全に落ちる） | 段を食い潰して後続をずらす犯人 |
| cap-late | 5.00 – 10.60 | 2.00 – 2.60 | cap-span と source では**重ならない**のに output では cap-span の帯の内側に入る |
| cap-dropped-tail | 12.40 – 13.00 | （尺外で落ちる） | 落ちた字幕が他に影響しないこと |

`fixture/captions-no-dropped.json` は上表から `cap-dropped-*` の 2 本だけを抜いた対照。
**「落ちた字幕の有無で残りの段が動くか」**をこの 2 本で測る。

## 実測（修正前 / 修正後、いずれも production ビルドの Electron + 生 CDP）

段番号は**字幕レーン帯の top を原点に `SUBROW_STRIDE`(36px) で割った値**。
レーン全体の絶対 top は段数によって中央寄せ量が変わるため、必ずレーン相対で測る。

| | 修正前 | 修正後 |
|---|---|---|
| 重なっている帯のペア（with dropped） | **4 組**（tiny 1-2 / 1-3 / 2-3、edge 1-2） | **0 組** |
| 重なっている帯のペア（no dropped） | **5 組**（上記 + cap-span × cap-late） | **0 組** |
| `cap-late` の段（with dropped → no dropped） | **1 → 0**（落ちた字幕の有無で**ずれる**） | **1 → 1**（ずれない） |
| 段の割り当て（no dropped） | 全員 row 0 | tiny1=0 / tiny2=1 / tiny3=2 / span=0 / edge1=0 / edge2=1 / late=1 |

修正前の `cap-span` × `cap-late` は **x 方向 28.25px・y 方向 32px 交差**（同じ段に完全に重なる）。
`prefix-nodropped-timeline.png` で「削除区[後半]ぐ字幕」と文字が重なって潰れているのが実際の見た目。

## 再現コマンド

```sh
# 1) L0
cd apps/shell && npm run build:ext && npm run lint
cd extensions/akari-annotations && npm test

# 2) 実機ビルド
cd apps/shell && npm run build

# 3) 隔離ワークスペースを作る（ffmpeg 必須）
node evidence/caption-subrow-output-space/scripts/setup-workspace.mjs <wsDir> [captions.json|captions-no-dropped.json]

# 4) Electron を CDP 付きで起動
THEIA_CONFIG_DIR=<uddDir> node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  <apps/shell 絶対パス> <wsDir> --remote-debugging-port=<port> --user-data-dir=<uddDir> --no-sandbox

# 5) 実 DOM を読んで矩形の重なりを判定
node evidence/caption-subrow-output-space/scripts/probe-captions.mjs <port> <wsDir> <evidenceDir> <label>
```

観測は**すべて実 DOM**（`.akari-annotations-strip-caption` の `getBoundingClientRect` と
`.akari-track-band[data-akari-kind="captions"]`）から取る。
`window.__akariPreview.summary` は差分更新で更新されないため使わない
（handoff-2026-08-20 §7-3 の既知の罠）。

## ファイル

- `probe-prefix.json` / `probe-prefix-nodropped.json` — 修正前の全アサーション実測値（FAILURES あり = 再現）
- `probe-postfix.json` / `probe-postfix-nodropped.json` — 修正後（`ALL CAPTION ASSERTIONS PASSED`）
- `*-timeline.png` — 同じ 4 条件のスクリーンショット
