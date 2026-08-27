# cuts パス実装・G1 実測レポート

この文書は `npm run bench:cuts` の完走時に、実 Chromium ゴールデンと同条件ベンチの実測値で
自動更新される一次資料である。

現セッションでは型検査と unit 9/9、render-cut x264 対照の実出力まで exit 0 を確認した。
一方、macOS のアプリ登録を許可しない実行サンドボックスにより Electron / Chromium は renderer
起動前に拒否された。実測は Electron direct が status 134、Playwright Chromium fallback が
`bootstrap_check_in ... Permission denied (1100)` / SIGTRAP、ベンチは renderer 結果未生成である。
そのため、ここへ最終値を捏造していない。受け入れ環境で次を順に実行すると、
ゴールデン全点、段階別 p50/p95、before/after、`v2/render-cut`、PSNR、G2 裁定案まで本ファイルへ
実測値付きで置換される。

```sh
cd packages/frame-engine
npm test
npm run bench:cuts
```

Phase 0 の同条件一次値は v2 10,321.481ms / render-cut 4,074.210ms、比 2.533。
実装後の値は未実走のまま断定しない。

改善実装は tight native plane の view 化、texture の `texSubImage2D` 再利用、WebCodecs 直結時の
`gl.flush` 化、canvas → H.264 Annex B → copy mux 出口で、raw RGBA readback / 8MB IPC / raw pipe
encode を最終経路から除外する。decode は cut ID ごとの独立 lane に分け、transition の 2 入力が
同じ MP4Clip を交互 seek しない。freeze の sub-frame 要求は直前 VideoFrame の表示区間 cache から返す。

## timeline-map カーネルへの freeze 昇格素案

現実装は frame-engine の `buildResolvedTimelinePlan` で、freeze 分だけ仮想 cut 尺を伸ばしてから
`buildTimelineMap` に transition overlap を解決させ、`playbackSecondsAt` が出力秒を
「前進→静止→前進」の区分写像へ戻す。

G2 で共有カーネルへ昇格する場合は `packages/edit-store/src/timeline-map.ts` の
`buildTimelineMap` に freeze-aware duration provider を追加し、`TimelineSegment` に
freezeAt / freezeDuration を持たせ、`outputToSource` の線形式を区分写像へ拡張する。
gap/track 併用時に後続をどの track cursor だけずらすかを先に裁定し、現行の明示例外を
無言許容へ変えないことを昇格条件とする。
