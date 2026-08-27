# @webav/av-cliper 保守現況（2026-08-27 調査）

- npm の最新版は **1.2.8** で、本パッケージも同版へ固定している（[npm search](https://www.npmjs.com/search?q=keywords%3Acliper)）。
- 開発元の WebAV mono-repo は 2026 年にも更新があり、`av-cliper` は引き続き基礎 SDK として案内されている（[WebAV repository](https://github.com/WebAV-Tech/WebAV)）。
- 公式な後継パッケージは示されていない。`@webav/av-canvas` は `av-cliper` に依存する上位 UI 層であり代替ではない（[package README](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-cliper/README.md)）。
- 既知の注意点は codec 対応範囲と MP4Box 基盤で、追加 codec 要望と Mediabunny への置換提案が open。現行の逐次 `tick()`・decoder error guard・末尾 GOP 防御は当面ラッパー側で維持する（[open issues](https://github.com/WebAV-Tech/WebAV/issues)）。

## B フレーム末尾の duration 修正

`@webav/av-cliper` 1.2.8 の meta 生成は、動画尺を「デコード順で最後の非 deleted サンプルの `cts + duration`」としていた。B フレームではデコード順末尾が表示順末尾とは限らず、最終表示コマの開始時刻が `meta.duration` になる素材がある。その境界で `MP4Clip.tick(t)` の `t >= duration` ガードが `{ state: "done" }` を返し、最終コマ全区間を取得できなかった。音声を無効にして開く frame-engine では音声尺はこの計算に関与しない。

`packages/frame-engine/vendor/av-cliper/` に npm 版 1.2.8 を MIT ライセンスとともに vendoring し、次の1箇所だけを変更する。

```diff
@@
   if (t.length > 0)
     for (let o = t.length - 1; o >= 0; o--) {
       const c = t[o];
-      if (!c.deleted) {
-        a = c.cts + c.duration;
-        break;
-      }
+      if (!c.deleted) a = Math.max(a, c.cts + c.duration);
     }
```

moov の `mvhd` / `mdhd` / `elst` duration を伸ばしても、この meta はサンプル表から再計算されるため直らない。また finder は private で、呼び出し側の時刻だけでは duration ガードと最終コマ coverage を同時に満たせないため、最小の vendoring パッチを採用した。非 deleted 全サンプルを走査するので `split()` が deleted を付ける経路を保ち、B フレームを持たない表示順＝デコード順の素材では従来と同値になる。

上流には meta の video duration を非 deleted サンプルの `max(cts + duration)` にする変更と、デコード順末尾が表示順末尾とは限らない再現 fixture を提案する。`videoDeltaTS = samples[0].dts` を `elst.media_time` にする件は別問題として切り分ける。**av-cliper の版を上げるときは `test:seek` を必ず実行する。**
