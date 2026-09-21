# generation-states — L1（実機 Electron・CDP）の証跡

task `2026-09-13-timeline-generation-states`（タイムラインの映像クリップに生成状態を出す）の L1。
スクリプトはラッパー（検証担当）が書いたもので、製品ソースではない。

## 走らせ方

```sh
cd apps/shell && npm run build        # lib/frontend/bundle.css に generation-chip.css が入る
node apps/shell/extensions/akari-annotations/evidence/generation-states/scripts/l1-generation-states.mjs
```

`scripts/gen-fixture.mjs` が `fixture/project/`（非コミット）を毎回作り直す。`generating` の
`job.started_at` は実行時刻、`stale` は `stale_after_s` を超えた時刻で書くので、実行日に依存しない。
Electron は隔離した `AKARI_HOME` / `--user-data-dir=runs/l1` で起動し、自分が spawn した PID だけを kill する。

## 中身

| ファイル | 内容 |
|---|---|
| `01-six-generation-states.png` | 6 状態（静止画 / planned / 生成中 62% / 応答なし・再取得 / 生成 / 失敗）を 1 枚に収めたタイムライン帯（2 倍切り出し） |
| `02-before-sidecar-rewrite.png` | サイドカー書き換え前 |
| `03-after-sidecar-rewrite.png` | `planned.png.meta.json` を `status: failed` へ書き換えた後（2 本目のクリップが点線→朱枠「失敗」） |
| `04-planned-video-and-generation-states.png` | task `2026-09-21-timeline-planned-video`: 動画予定 3 種（最初→最後 = 両端に別の絵 + 鎖 / 画像から = 左端だけ / プロンプトだけ = 文字）と既存 6 状態を 1 枚に。タイムラインは最大化して撮る（既定幅だと 64px 未満で狭幅表示へ落ちるため） |
| `05-before-next-rewrite.png` / `06-after-next-rewrite.png` | `next-first-last.png.meta.json` の `next.inputs` をプロンプトだけへ書き換えた前後（再読込なし） |
| `07-planned-video-zoom.png` | 動画予定 5秒×3本と1.4秒の狭幅1本の実DOM範囲を CDP `clip`・scale 3 で切り出した拡大図 |
| `results.json` | 各手順の実測値（動画予定の絵のセル数・鎖の有無・再生中の新規サムネ取得回数を含む）（各クリップの state / badge / 算出スタイル、反映までの ms、edit.json / captions.json の mtime、後始末） |

`fixture/` と `runs/` は生成物なのでコミットしない。

差し戻し r1 の計測は `plannedLayout` に保存する。札・表示中の時刻・絵ラベル・中央の名前/指示文・鎖の
`getBoundingClientRect()` を総当たりで非交差判定し、文字がクリップ内に収まること、中央の文字がヘッダ・絵・穴の領域と重ならないことも検査する。
セルは高さがクリップの70%以上、幅が `min(セル高さ×16/9, クリップ幅×0.4)`、cover を確認する。
穴は専用子要素の上下2本の rect・位置・gradient・opacity に加え、8px周期の楕円中心を
`elementFromPoint` で調べて前面に描かれる点が各列にあることを検査する（計測中だけ子要素の
pointer-events を有効にし、必ず復元する）。種類札は不存在または display:none、狭幅1本は実幅40px以上64px未満・名前の表示幅>0・札「▶」を assert する。
通常3本は時刻を必須 role とし、表示幅>0・右上の位置・書式/色・`elementFromPoint` による前面表示・他の文字との非交差も assert する。
時刻の非表示条件は、名前付き clip container の幅が128px未満のときだけ。
既存6本の fixture の尺・状態は維持し、隣接する next-first-last → next-first の素材一致も引き続き検査する。
