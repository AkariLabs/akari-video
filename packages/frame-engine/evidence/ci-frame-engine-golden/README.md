# frame-engine-golden の中点選択修正

## 失敗履歴

- 最後の成功は `146c41fb0`（run `34367574245`、2026-09-09 15:02 UTC）。最初の失敗は `645bf9c8d`（run `34606533531`、2026-09-11 13:49 UTC）。この区間で frame-engine を変更したのは `c387635d6`、`b812bf282`、`73b88548a`。最初の失敗は後者の「最も近い PTS、同点は前」を導入した合流時点に当たる。
- 最初の失敗時から `gop-tail-seek.mjs:51` の `profileCold` で `profile decoded 121, wanted 120`。9/14、9/20、9/23、10/2 の main（`f1c942fbb`）でも同じ。9/26〜10/1 の確認済み run は audio 単体テスト 2 件が BGM/duck 警告の deep-equal 不一致で先に止まり、seek に到達していない。
- 9/29 の #102（`native-yuv.ts`、`range-mp4-source.ts`）は失敗の起点より後。デコーダの空回り対策は維持する。

## 機構

fixture は timescale `15360`、1 コマ `512` tick（`33333.333…` µs）、GOP 30、B フレームなし、240 コマ。サンプル PTS と WebCodecs の timestamp/duration は整数 µs に丸められる。frame 120 は `4000000` µs、frame 121 は `4033333` µs、duration は `33333` µs。要求時刻 `frameMidpointUs(120)` は `4016667` µsで、元の tick では真の同点なので前の 120 が仕様上の答えになる。

整数値だけで比較すると、120 からの距離は `16667` µs、121 からの距離は `16666` µs。旧 `sampleAtPresentationTime` は 121 を選び、旧 frame coverage も半幅 `16666.5` µs に対して 120 を対象外、121 を対象内と判定した。frame 29 の中点 `983333` µs は丸めの向きが逆なので 29 のままだった。新規 `ClipSessionPool.decode()` は既定で range 経路を通り、この sample table と `range-mp4-source.ts` の coverage 判定が実際に使われる。`clip-session.ts` の coverage と exact tick 継続も同じ規則を参照する。

## 修正と検証

隣接 PTS への距離差が 1 µs 以下なら前を選ぶ共有ヘルパーを導入した。sample table と両 coverage 経路がこれを使う。近傍選択の kill switch `AKARI_FRAME_ENGINE_NEAREST=0` は従来の floor/半開区間を使い、VFR の近傍選択は継続する。

赤→緑は、判定ロジックを変えない `origin/main` の frame-engine を別の場所でビルドし、`frameCovers` にテスト用の export だけを付けて確認した。追加テスト `quantized 15360-timescale midpoint selects frame 120 across sample table and both coverage paths` は修正前に `121 !== 120` で赤、修正後に緑。更新した既存の `decoded frame coverage uses nearest half-frame boundaries and prefers the earlier frame on ties` も修正前に `false !== true` で赤、修正後に緑。追加テスト `oppositely rounded midpoint at frame 29 still selects earlier, and floor switch stays half-open` は修正前から緑で、逆向きの丸めと kill switch の回帰ガードである。

既存テストの境界期待値も同じ規則に合わせた。frame 12（`400000` µs）と 13（`433333` µs）の真の中点は `416666.67` µs で、丸めた `416667` µs は同点として前の 12 を選ぶ。旧期待値は整数 µs の半幅 `16666.5` µs を境界として固定しており、それ自体が今回の不具合の形だった。`383334` µs も同じ 1 µs の同点許容で前のコマに倒す。実フレーム間隔は数千 µs 以上なので、VFR の最近傍選択という意図は維持される。

単体テストは修正前 624 件中 620 PASS・0 FAIL・4 SKIP、修正後 626 件中 622 PASS・0 FAIL・4 SKIP。使う側の基点比は gpu-export が 516 件中 2 FAIL → 同じ 2 FAIL、osr-export が 241 件中 5 FAIL → 同じ 5 FAIL、akari-preview の frame-engine 関連が 113 件中 1 FAIL → 同じ 1 FAIL。これらは Windows 既存の失敗（akari-preview は L1 証跡 redaction）で、新規 FAIL は 0。

生成バンドルは gpu-export、osr-export、akari-preview の drift が PASS。preview-server の `frame-engine.bundle.js` は `packages/preview-server` を作業ディレクトリとする正規の esbuild 引数で再生成し、同条件の再生成出力とのバイト一致を確認した。

## 修正後 seek

Windows 11・Electron 39.8.7 tier 2 で、`gop-tail-seek.mjs` の assert 群をそのまま評価する再現ランナーを実走。修正前は既定 GPU で `profile decoded 121, wanted 120` により FAIL。修正後は既定 GPU で PASS（Electron 84 s）、CI と同じ `--disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader` でも PASS（50 s）。`requestCount` は 94、`finalFrameNumber` は 239、`clipSession` は全件一致、lookahead hits は 8。
