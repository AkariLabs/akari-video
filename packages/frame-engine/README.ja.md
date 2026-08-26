[English](./README.md) | **日本語**

# @akari-video/frame-engine

`frame-engine` は edit-store が解決済みのタイムライン時刻を、1枚の完成 WebGL2 surface へ評価します。同じ `CompositedFrame` を canvas preview 出口と PBO raw-frame 出口が消費し、`evaluateFrame` 自体は preview/export モードを持ちません。

Phase 1a の対応範囲はハードカットだけです。速度、framing、transform、freeze、transition はこの版の対象外です。

## ローカル検証

ゴールデンハーネスは Chromium の WebCodecs と WebGL2 実装を必要とします。まずリポジトリにある Electron を起動し、ホストが GUI app を登録できない場合だけ同じ renderer bundle を Playwright Chromium で実行します。H.264 フィクスチャは ffmpeg で生成し、動画と証跡は gitignore 済みの `test/golden/.generated/` にだけ置きます。

```sh
cd packages/frame-engine
npm run typecheck
npm run test:unit
npm test
```

`npm test` は build、unit test、Electron 実走、preview/export の RGBA・PNG hash 一致、故意の1px改変を比較器が棄却すること、MP4 encode 後の抽出フレームが静止していないことを一括検証します。段階別集計は `test/golden/.generated/metrics.json` に生成されます。

CI runner が GPU/WebCodecs 対応 Chromium を持たない場合、Electron/WebCodecs 試験はローカル専用です。unit test と typecheck はその種の CI でも実行できます。

固定した demux/decode 依存の評価は [av-cliper 保守現況](./docs/av-cliper-status.md) を参照してください。
