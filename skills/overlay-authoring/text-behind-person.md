# Text behind person

native 映像の上へ文字を置き、その上へアルファ付き人物動画を重ねる。視覚上の順序は必ず `base video < text < cutout video` にする。

## 現在の制約を先に判定する

edit.json v1 の `<video>` 時刻同期は未実装である。現行 preview / export は CSS / WAAPI animation の `currentTime` だけを同期し、fragment 内 `<video>.currentTime` は操作しない。`data-akari-sync` を付けても現時点では効果がない。

したがって、動く人物の text-behind-person を決定的・WYSIWYG・本番対応済みと報告しない。選択肢は次のいずれかにする。

- 静止した人物 alpha PNG / matte で表現する。
- 外部で text-behind-person を precompose して映像素材にする。
- v1 runtime の video sync 実装を待ち、preview と export の双方で検証する。

根拠: `docs/notes-2026-07-13-edit-json-v1.md` §4、`ui/overlay-runtime.js`、`scripts/render-overlays.mjs`

## マット参照規約

人物マット（アルファ付き人物動画）を断片から参照する書き方を規約として固定する。データ契約の正本は
[docs/contract-2026-07-23-analysis-person-matte.md](../../docs/contract-2026-07-23-analysis-person-matte.md)、
生成手順は [skills/analyze-footage/person-matte.md](../analyze-footage/person-matte.md) にある。
本節はその**消費側**（断片の書き方）だけを定める。

### 1. 供給元と複製規律

マットの供給元は `analysis.json` の `tracks.person_matte`（契約 §2）が正である。断片を書く
エージェントは authoring 時に次を行う。

1. `person_matte.path` を **analysis.json の所在ディレクトリ基準**で解決する（契約 §2 フィールド表）。
   `null` や解決不能なら人物マット無しとして通常のテロップ構成に倒す（契約 §5 の劣化規約）。
2. 解決した実体を**プロジェクト内へ複製**する。置き場は `assets/matte/<素材名>-person-matte.webm`
   を既定とする。
3. 断片からは複製先を **edit.json 相対（プロジェクト相対）パス**で参照する。

analysis 側のパスへ直リンクしない。マットは素材ディレクトリ側に置かれうるため、直リンクした
プロジェクトは移動・配布・再現でリンクが切れる（プロジェクト自己完結の原則）。プレビューの
asset 解決（3D 宣言の `resolveAsset`・`akari-preview-open-handler.ts`）も先頭 `/` と URL スキームを
拒否しており、絶対パスや `file:` URL を書く流儀そのものが通らない。

**複製はバイト単位のコピーで行い、再エンコードしない。** ffmpeg のデコーダに通すとアルファが
無言で落ちる（契約 §3）。切り出し（`--ss` 相当）も禁止 — 時刻 0 の一致が壊れる（契約 §4）。

### 2. 断片内の参照は `data-akari-matte-src`

**`<video>` の `src` を断片の HTML に直書きしない。** 外側コンテナ（ランタイムが作る
`.akari-overlay-container` / `#overlay-stage` 直下の div）へ注入される
**`data-akari-matte-src` 属性**を規約とし、断片はその属性の有無だけを見る。

タイミングの `data-start` / `data-duration`（ハードルール 2）と同じ「**ランタイムが所有する
data 属性**」の流儀である。理由も同じで、実 URL は経路ごとに違うものになる:

| 経路 | 実際に必要な URL |
|---|---|
| プレビュー | `http://127.0.0.1:<port>/asset/<id>`（`createAssetStream` の払い出し。3D の `.glb` と同経路） |
| 書き出し（render-cut） | オーバーレイシートは `<projectRoot>/.akari/render-tmp/<run>/overlay-sheet.html` に置かれる。プロジェクト相対パスをそのまま書くと 3 階層ずれて解決できない |

断片が知ってよいのはプロジェクト相対パスまでで、経路ごとの実 URL 化は外側の責務である。

属性が無いときは**マット層を出さない**。祖先属性ゲート付きセレクタで宣言する
（`data-akari-active` と同じ手法。`packages/overlay-runtime/src/overlay-runtime.js` 参照）:

```html
<div class="tbp-root">
  <style>
    .tbp-root { position: absolute; inset: 0; isolation: isolate; }
    .tbp-root__text {
      position: absolute; z-index: 1;
      left: var(--text-x, 8%); top: var(--text-y, 42%);
      font-size: var(--font-size, 96px); color: var(--color, #fff);
    }
    /* マット層は既定で出さない。外側コンテナに属性が注入されたときだけ出す。 */
    .tbp-root__matte { display: none; }
    [data-akari-matte-src] .tbp-root__matte {
      display: block;
      position: absolute; inset: 0; z-index: 2;
      width: 100%; height: 100%;
      object-fit: var(--matte-fit, cover);
      object-position: var(--matte-position, 50% 50%);
      pointer-events: none;
    }
  </style>
  <div class="tbp-root__text">正確な日本語テキスト</div>
  <video class="tbp-root__matte" muted playsinline preload="auto"></video>
</div>
```

**劣化は「文字が前に出るだけ」**にする。属性が無い・マットが読めない・再生できない、いずれでも
テキストと素材映像は出続ける。人物マットは演出の入力であり、映像本体の成否を左右しない（契約 §5）。

### 3. 標準 3 層構造（z）

| 層 | 実体 | 断片に含めるか |
|---|---|---|
| 下 | 素材映像（プレビューの `#preview-video` / 書き出しの合成土台） | **含めない** |
| 中 | テキスト（`z-index: 1`） | 含める |
| 上 | マット `<video>`（`z-index: 2`・`inset: 0`・`muted`・`playsinline`・`pointer-events: none`） | 含める |

- 断片ルートに `isolation: isolate` を置き、この 2 層の重なりをルート内へ閉じる（単一ルート =
  ハードルール 6）。
- テキストの `z-index` をマットより必ず小さくする。逆にすると通常のテロップに戻る。
- マット `<video>` の `object-fit` / `object-position` を素材映像側の crop 契約に合わせる。ずれると
  人物の輪郭が背後の素材とずれる。
- 調整値（テキスト位置・文字サイズ・色・マットの fit / position）は CSS 変数で公開する
  （ハードルール 1）。断片ルートで同名変数を再定義して外側からの上書きを遮らない。

### 4. 形式は VP9 alpha WebM が第一、HEVC alpha は fallback

- **第一候補（既定）**: VP9 alpha WebM（`.webm` / `alpha_mode=1` / straight alpha）。契約 §3 の確定事項。
  容量が HEVC alpha MOV の 1/4.8 で、**GPU デコードに依存しない**。書き出し経路のヘッドレス Chrome は
  `--disable-gpu` で起動する（`packages/render-cut/src/rasterize.mjs`）ため、HEVC を既定にすると
  経路ごと落ちる。
- **fallback（第 2 形式）**: HEVC alpha MOV。Apple 系ツールへの受け渡しが要るときだけの互換形式で、
  `analysis.json` に載せる既定ではない。本リーフの「Apple Vision → HEVC with alpha」「Robust Video
  Matting → HEVC with alpha」は、この第 2 形式を自前で作るときの手順である。
- 断片側は形式を判別しない。`data-akari-matte-src` が指すものを再生するだけにする。形式の選択は
  供給側（`analysis.json`）の責務であり、断片に `<source type="...">` の分岐を書かない。

### 5. poster フォールバック（プレビュー制約への保険）

プレビューの webview は `default-src 'none'; media-src <stream origin>; img-src <stream origin> blob: data:`
という CSP 下にある（`akari-preview-open-handler.ts`）。`data:` の**画像**は許されるが、`media` は
払い出されたストリームオリジンに限られる。マットを asset stream へ載せる解決経路は現時点で未実装
であり、断片を単体で開いた場合も含めて**プレビューでマット `<video>` が再生されない場面がある**。

そこで **`poster` にデータ URI の静止マット 1 枚**を置くことを任意フォールバックとして規約化する。

```html
<video class="tbp-root__matte" muted playsinline preload="auto"
       poster="data:image/png;base64,iVBORw0KGgo…"></video>
```

- 代表フレーム（そのオーバーレイ区間の中央あたり）をアルファ付き PNG で **1 枚だけ**入れる。マット
  生成の既定解像度は 512x384（`balanced`・person-matte.md の実測表）であり、poster もその解像度で足りる。
  data URI は断片 HTML に丸ごと載るため、桁が大きくなるなら PNG 側の解像度を落とす。
- CSP で `media` が落ちても poster は描画されるため、**人物とテキストの前後関係**（この演出の要）は
  プレビューで確認できる。
- **poster は静止画である。動きはレンダで確認する。** poster が出ていることを「マットが動いている」
  ことの確認と読み替えない。poster だけを最終成果物の代替にしない。

### 6. 決定性

- マット動画の時刻は素材（`analysis.source`）の source 秒と **1:1** で対応する（契約 §4）。
  マット側にオフセットを持たせない。
- **断片内で独自の時刻源を作らない**（ハードルール 2 / 4 の再確認）。`autoplay` / `loop` /
  `setTimeout` / rAF の delta 積算でマットを進めない。`<video>` の時刻を進めるのはランタイムであり、
  断片は宣言するだけにする。
- 現状の実測: 書き出し経路は全 `<video>` に**コンポジション秒をそのまま**代入する
  （`rasterize.mjs` の `__akariSeek`）。`cuts[]` を介した source 秒への射影は行わない。素材の途中区間を
  使うカットではマットが合わない。プレビューは `<video>.currentTime` を触らない。したがって
  **動く人物のマットは今も本番品質ではない**（冒頭「現在の制約を先に判定する」と同じ結論）。静止マット
  （poster / 単一フレーム）は現時点でも決定的に成立する。

## Apple Vision → HEVC with alpha

以下 2 節は**第 2 形式（HEVC alpha MOV）を自前で作る**ときの手順である。既定の生成経路は
`analysis.json` の `tracks.person_matte`（VP9 alpha WebM）であり、手順は
[skills/analyze-footage/person-matte.md](../analyze-footage/person-matte.md) にある。

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

単一ルートの中に同じ座標系で text と cutout video を置く。以下は最小骨格であり、`src` の与え方・
既定で隠す指定・poster フォールバックまで含めた正の書き方は上の「マット参照規約」にある。

```html
<div class="tbp-root">
  <style>
    .tbp-root { position: absolute; inset: 0; isolation: isolate; }
    .tbp-root__text { position: absolute; z-index: 1; }
    .tbp-root__matte { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  </style>
  <div class="tbp-root__text">正確な日本語テキスト</div>
  <video class="tbp-root__matte" muted playsinline preload="auto"></video>
</div>
```

- text の z-index を cutout video より小さくする。
- `<video>` の `object-fit` / `object-position` を base video と同じ crop 契約に合わせる。
- `--text-x`、`--text-y`、`--font-size`、`--matte-fit`、`--matte-position` などを knob にする。
- alpha video を autoplay / loop 任せにしない。将来は `data-akari-sync` 付き video の currentTime を overlay local timeline へ設定する runtime 契約が必要になる。
- relative video URL の live preview 解決も現状未整備なので **要検証** とする。

## よくある間違い

- `data-akari-sync` が既に実装済みだと書く。
- マット `<video>` の `src` を断片へ直書きする（プレビューでも書き出しでも解決できない）。
- `analysis.json` 側のマットへ直リンクし、プロジェクトの自己完結を壊す。
- マットをプロジェクトへ複製するときに ffmpeg で再エンコードし、アルファを無言で落とす。
- `data-akari-matte-src` が無いときにマット層を出したまま黒や空の矩形を人物の上に残す。
- poster が出ていることを「マットが動いている」ことの確認と読み替える。
- alpha video を autoplay し、映像本体と偶然合うことを期待する。
- text を人物 layer より前へ置き、通常のテロップに戻してしまう。
- base と cutout で crop / orientation / fps / PTS が違う。
- Vision sample の camera orientation を全動画へ hardcode する。
- RVM の recurrent state を捨てて frame を独立処理する。
- RVM の foreground / alpha 出力を HEVC-alpha 完成品と思い込む。
- GPL-3.0 の RVM コードや model を本リポへコピーする。
- 新シェルの preview（Chromium/Electron）で見えたため、export 用のヘッドレス Chrome 系レンダラーでも同じに動くと未検証で断言する。（旧 Tauri 版は Safari / WKWebView 前提だったが、新シェルは Chromium 系に統一）
