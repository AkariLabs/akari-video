# rasterize seek fix — 最終判断メモ

## 最終結論

決定性は合格。性能の受け入れ条件「レンダ所要時間の悪化が概ね 1 割以内」は、**未達**と判断する。

fixed は同一入力の 120 フレームを 3 試行で全て SHA-256 一致させ、ラッパーの独立再実行でも
全フレーム一致、警告 0 を再現した。一方、性能は低ノイズ計測で rVFC の本質的な追加待機が確認され、
全プロセス計測も独立試行間で 1 割以内を安定して再現できなかった。1 割以内だった試行だけを選んで
合格とはしない。

## 一次指標: 同一ページ内の交互 seek 計測

ブラウザを 1 回だけ起動し、同一ページ・同一 video 要素上で次を交互に各 200 回呼んだ。

- fixed: 本番の `window.__akariSeek`
- legacy: `pause()` と `currentTime` 設定後に即時 return する旧実装相当

各時間は `page.evaluate` 内の `window.performance.now()` で測り、Chrome 起動、ページロード、
Node↔ブラウザ IPC をサンプル区間から除外した。各呼び出し後は video の seek 完了を区間外で待ち、
次サンプルへの干渉を防いだ。20 回ずつのウォームアップも測定対象外とした。

2026-07-23 の最終実測:

- legacy median: `0.2ms`
- fixed median: `28.9ms`
- 追加 median: `28.7ms`
- legacy mean: `0.513ms`
- fixed mean: `67.659ms`
- 追加 mean: `67.145ms`
- fixed p95: `249.5ms`
- fixed max: `666.9ms`
- 警告: `0`

ラッパーの独立診断でも legacy median `0.10ms`、fixed median `16.90ms`、追加 median `16.80ms`、
追加 mean `57.58ms` だった。両環境とも典型値は動画フレーム提示 1 回分程度で、mean が median より
大きく、single-process Chromium / ホスト負荷由来とみられるロングテールも確認できる。

legacy がほぼ 0ms なので seek 単体の増加率は総レンダ時間の増加率として有用ではない。
重要なのは、fixed が「ターゲットフレームの提示」を待つため、十数〜数十 ms の追加コストが
原理的に存在することと、そのコストを消すには提示前 return へ戻す必要があること。

## 参考指標: 全プロセス計測の変動

640×360 / 24fps / 5 秒 / 120 フレームを legacy/fixed 各 3 回、交互に
`captureWithPuppeteer` で実行した。Chrome 起動、readiness、seek+screenshot、
ブラウザ終了、透過 qtrle MOV エンコードを区間別に記録している。

最終実測:

- 旧「追加 seek / legacy frame loop」正規化値: `+10.90%`
- フレームループ中央値: `+44.62%`
- Chrome 起動から透過 MOV 生成までの中央値: `+31.41%`

同一コード・同一スクリプトの過去および独立実行:

| 実行 | 旧正規化値 | フレームループ | MOV 生成まで |
|---|---:|---:|---:|
| Codex 前回 | `+7.12%` | `+5.97%` | `-5.17%` |
| ラッパー round 2 | `+40.87%` | `+26.94%` | `+7.09%` |
| Codex 最終 | `+10.90%` | `+44.62%` | `+31.41%` |

ラッパー round 2 の legacy frame-loop median は `12858ms`、Codex 前回は `44359ms` と
3 倍以上異なった。最終実行でも Chrome launch は fixed 側だけで `492ms`〜`6408ms` に振れた。
このサンドボックスの `--single-process --no-zygote` Chromium におけるホールクロック値は、
起動だけでなく screenshot / encode / seek の各区間もホスト負荷の影響が大きい。
したがって全プロセス値は代表シナリオの参考証拠として残すが、単独の合否指標にはしない。

## 受け入れ条件の最終見解

1. 低ノイズ一次指標は、fixed に追加 median `28.7ms`、追加 mean `67.145ms` の提示待機があると示した。
2. 全プロセス計測は大きく変動し、1 割以内の回もあるが、独立再実行と最終実行では複数スコープが
   明確に 1 割を超えた。
3. よって「概ね 1 割以内」を再現可能に満たすとは判断できず、最終 verdict は `not_met` とする。

トレードオフは明確である。rVFC 待機を外せば legacy の速度へ戻せるが、ターゲット動画フレームが
提示される前に screenshot へ進み、既に独立検証で修正効果が確認された stale-frame の非決定性を
再導入する。現在の実装は正しさを優先した最小構成であり、この最終ラウンドでは `src/` を追加変更しない。

## 実装判断

rVFC 対応ブラウザでは次の順序にしている。

1. `video.currentTime` をターゲットへ変更する
2. 同じ JavaScript タスク内で `requestVideoFrameCallback` を登録する
3. 最初に提示された動画フレームで完了する

変更後に rVFC を登録するため旧フレーム用の予約通知を拾わず、rVFC と別に `seeked` や二重 rAF を
待たない。既にデコード済みの同一時刻は即時完了し、複数 video は `Promise.all` で並列待機する。
rVFC 非対応時だけ `seeked` 後の二重 rAF を維持する。

## 再現

```sh
cd packages/render-cut
CHROME_PATH=/path/to/chrome node evidence/rasterize-seek-fix/l2-determinism.mjs
node --test test/*.test.mjs
```

測定スクリプトは `l2-result.json` を更新する。決定性違反、警告、または最終性能 verdict が未達の
場合は exit code 1 を返す。今回の exit code 1 は性能 verdict `not_met` を正直に表す。
