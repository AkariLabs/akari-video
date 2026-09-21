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

## 全状態のチップ配置（2026-09-22）

`chipLayout` は動画予定以外の8表示（空の枠・予定・生成中・応答なし・失敗・孤児・生成・静止画）を
対象にする。`planned` は `inputs.prompt` が空・空白だけなら「空の枠」、文字があれば「予定」。
既存10本の配置（0〜28.4秒）を変えず、先頭の映像トラック `video` の末尾へ
通常幅用の6秒×8本（28.4〜76.4秒）、狭幅用の1.4秒×8本（76.4〜87.6秒）を連続追加する。
全26本とも `cut` として描く。2本目以降の visual トラックは `layer` 描画になり、
生成チップを持たないため追加しない。孤児は実素材と異なる `result.sha256`、予定は prompt 付きサイドカーで再現する。
生成 API への送信は行わない。通常幅と狭幅のコピーは同じ素材を参照するため、後段のサイドカー更新では
コピーも同時に変わる。既存の更新検査は元の10本について引き続き行う。

最大化後も全87.6秒への全体表示は使わず、既存01〜07と `plannedLayout` は0〜28.4秒の表示範囲で撮る。
DOMの仮想化により画面外のクリップは未マウントになるので、全26本の同時出現を待たず、
現在検査するラベルだけを照合する。item-idの番号には依存しない。
通常幅8本の08/09撮影では、既存範囲で測ったpx/秒を維持するようCDPのviewport幅を広げ、
27.9〜76.9秒へ移動する。10は元のviewport幅・表示秒数に戻して末尾へ移動する。
最後に必ず0〜28.4秒へ戻す。各表示範囲・実測px/秒・viewportは `timelineViews` に保存し、
通常幅撮影と復元後の倍率が元の実測値から0.1px/秒以上ずれていないことを検査する。

`scripts/cdp-lib.mjs` の `CHIP_LAYOUT` / `assertChipLayout` は次を検査する。

- 各チップの札・名前・時刻の実DOM矩形を取得し、表示中の全組み合わせについて交差0。
  `pairs` に交差幅・高さ、`intersections` に交差した組を保存する。
- 状態札は1枚、種類札は非表示。状態札の計算後背景色は透明でなく、札は左上、時刻は右上。
  ヘッダと各表示矩形がクリップ内に収まり、名前は ellipsis を使う。
  通常幅の長い名前では `scrollWidth > clientWidth > 0` も必須にし、実際に省略が発生することを確認する。
- コンテナの内容幅128px未満で時刻、96px未満で名前、64px未満で札の全文を隠す。
  64px未満では先頭の1文字を表示する。通常幅 fixture の外寸は130px以上（内容幅128px以上）、
  狭幅 fixture の外寸は40px以上64px未満を必須にする。
  全文は各要素の title と、ポインタを受け取るクリップ自身の title に保持する。
- `plannedLayout` の計測関数・判定・キーは従来のまま残す。

新しい証跡は以下の3枚。いずれも実DOMの矩形から切り出し、対象全体が viewport 内にあることを検査する。

| ファイル | 内容 |
|---|---|
| `08-all-generation-chip-states.png` | 通常幅の全8表示を2倍で撮影 |
| `09-empty-frame-zoom.png` | 空の枠を3倍で拡大。札・名前・時刻の読みやすさを確認 |
| `10-narrow-generation-chip-states.png` | 狭幅の全8表示を3倍で撮影。札の1文字が残ることを確認 |

末尾配置へ修正した後の Electron 検証はラッパーが行い、08〜10と `chipLayout` を生成する。
以前の画像・results.json はこの配置の合格根拠にはしない。
ラッパーは L1 実行後に3枚を開いて文字の可読性を確認してから受け入れること。
`chipLayout.visualReview` の初期値は `pending`。スクリプトの `status: pass` は機械検査の結果のみを表す。

単体テストは `test/fixtures/generation-states/chip-layout.json` の8表示と幅境界128/96/64pxを使い、
CSSの実際の非表示条件、札の再適用・titleの復元、およびL1判定が意図的に壊した計測値を拒否することを検査する。
L1と同じ純関数 `buildTimelineFixture` を使い、先頭トラック1本・既存10本の位置と尺・追加16本の連続配置・
87.6秒の総尺を検査する。表示範囲のラベル照合と、撮影用viewportの倍率計算も単体テスト対象。
