# Text behind person

native 映像の上へ文字を置き、その上へアルファ付き人物動画を重ねる。視覚上の順序は必ず `base video < text < cutout video` にする。

## 現在の制約を先に判定する

edit.json v1 の `<video>` 時刻同期は未実装である。現行 preview / export は CSS / WAAPI animation の `currentTime` だけを同期し、fragment 内 `<video>.currentTime` は操作しない。`data-akari-sync` を付けても現時点では効果がない。

したがって、動く人物の text-behind-person を決定的・WYSIWYG・本番対応済みと報告しない。選択肢は次のいずれかにする。

- 静止した人物 alpha PNG / matte で表現する。
- 外部で text-behind-person を precompose して映像素材にする。
- v1 runtime の video sync 実装を待ち、preview と export の双方で検証する。

根拠: `docs/notes-2026-07-13-edit-json-v1.md` §4、`ui/overlay-runtime.js`、`scripts/render-overlays.mjs`

## Apple Vision → HEVC with alpha

1. source を presentation order で decode し、各 frame の PTS と orientation を保持する。
2. 同じ `VNSequenceRequestHandler` へ frame を順番に渡し、`VNGeneratePersonSegmentationRequest` で person mask を得る。offline 品質では `.accurate` を候補にできるが、速度と輪郭品質を実素材で検証する。
3. camera 固有の orientation を hardcode せず、入力 orientation を反映して mask を source extent へ合わせる。
4. mask を alpha として RGB と合成し、alpha-bearing pixel buffer を作る。方式に迷う場合は Apple 推奨の premultiplied alpha を使う。
5. `AVAssetWriterInput` または `VTCompressionSession` を `AVVideoCodecType.hevcWithAlpha` で構成し、元 PTS の順に append して `.mov` を出す。alpha quality は公式に 0.0〜1.0 の範囲だが、固定値は発明せず **要検証** とする。
6. 出力 track の `.containsAlphaChannel`、duration、fps、frame count、orientation を確認し、checkerboard 上で髪、指、motion blur、半透明境界を実見する。
7. 新シェル（Chromium ベースの Electron）の preview と、export に使う Chrome 系レンダラーの両方で当該 asset を実機再生する。codec 名だけで互換性を保証しない。（旧 Tauri 版は WKWebView 前提だったが、新シェルは Chromium 系に統一）

公式:

- [Apple Vision — VNGeneratePersonSegmentationRequest](https://developer.apple.com/documentation/vision/vngeneratepersonsegmentationrequest)
- [Apple Vision — VNSequenceRequestHandler](https://developer.apple.com/documentation/vision/vnsequencerequesthandler)
- [Apple — Applying Matte Effects to People in Images and Video](https://developer.apple.com/documentation/vision/applying-matte-effects-to-people-in-images-and-video)
- [Apple — HEVC Video with Alpha](https://developer.apple.com/videos/play/wwdc2019/506/)
- [Apple — AVVideoCodecType.hevcWithAlpha](https://developer.apple.com/documentation/avfoundation/avvideocodectype/hevcwithalpha)
- [Apple — AVMediaCharacteristic.containsAlphaChannel](https://developer.apple.com/documentation/avfoundation/avmediacharacteristic/containsalphachannel)

## Robust Video Matting → HEVC with alpha

1. RVM の license を先に確認する。公式 repository は GPL-3.0 であるため、コードや model を MIT の本リポへ同梱・転写しない。外部の「手」として使う場合も version、license、取得元を provenance に残す。
2. frame 順を保ち、RVM の recurrent state を次 frame へ渡して foreground (`fgr`) と alpha (`pha`) を得る。各 frame を独立並列処理しない。
3. 公式 converter の `output_foreground` / `output_alpha` は別出力であり、HEVC alpha 直出力ではないと理解する。
4. premultiplied を使う場合は `RGB = fgr * pha`、`A = pha` として alpha-bearing frame を作り、元 fps / PTS と照合する。
5. Apple Vision 経路と同じ AVFoundation HEVC-alpha encoder へ渡し、同じ検証を行う。

公式: [Robust Video Matting repository](https://github.com/PeterL1n/RobustVideoMatting)、[RVM inference guide](https://github.com/PeterL1n/RobustVideoMatting/blob/master/documentation/inference.md)

## DOM の z 順

単一ルートの中に同じ座標系で text と cutout video を置く。

```html
<div class="tbp-root">
  <style>
    .tbp-root { position: absolute; inset: 0; isolation: isolate; }
    .tbp-root__text { position: absolute; z-index: 1; }
    .tbp-root__person { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  </style>
  <div class="tbp-root__text">正確な日本語テキスト</div>
  <video class="tbp-root__person" muted playsinline preload="auto"></video>
</div>
```

- text の z-index を cutout video より小さくする。
- `<video>` の `object-fit` / `object-position` を base video と同じ crop 契約に合わせる。
- `--text-x`、`--text-y`、`--font-size`、`--person-scale`、`--person-position` などを knob にする。
- alpha video を autoplay / loop 任せにしない。将来は `data-akari-sync` 付き video の currentTime を overlay local timeline へ設定する runtime 契約が必要になる。
- relative video URL の live preview 解決も現状未整備なので **要検証** とする。

## よくある間違い

- `data-akari-sync` が既に実装済みだと書く。
- alpha video を autoplay し、映像本体と偶然合うことを期待する。
- text を人物 layer より前へ置き、通常のテロップに戻してしまう。
- base と cutout で crop / orientation / fps / PTS が違う。
- Vision sample の camera orientation を全動画へ hardcode する。
- RVM の recurrent state を捨てて frame を独立処理する。
- RVM の foreground / alpha 出力を HEVC-alpha 完成品と思い込む。
- GPL-3.0 の RVM コードや model を本リポへコピーする。
- 新シェルの preview（Chromium/Electron）で見えたため、export 用のヘッドレス Chrome 系レンダラーでも同じに動くと未検証で断言する。（旧 Tauri 版は Safari / WKWebView 前提だったが、新シェルは Chromium 系に統一）
