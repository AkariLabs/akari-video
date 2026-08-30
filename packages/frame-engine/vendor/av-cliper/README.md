# vendored @webav/av-cliper

- 出所: npm `@webav/av-cliper`
- 版: `1.2.8`
- ライセンス: MIT（`LICENSE` を同梱）
- 持ち込んだファイル: `av-cliper.js`、`av-cliper.d.ts`、`LICENSE`
- source map は持ち込まず、`av-cliper.js` 末尾の `sourceMappingURL` も削除している。

## ローカルパッチ

動画尺をデコード順で最後の非 deleted サンプルから取ると、B フレームの表示順末尾を覆えないことがある。非 deleted 全サンプルの `cts + duration` の最大値を使う。

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

上流へ戻すときは、この max 算出が取り込まれた版へ更新して vendor と相対 import を外す。`videoDeltaTS = samples[0].dts` を `elst.media_time` にする件は別問題として扱う。

`__unsafe_skipRotation__` 指定時は、tkhd 回転を毎フレームの OffscreenCanvas へ焼かず、
デコーダ出力をそのまま返す。表示回転は呼び出し側が一度だけ適用できるよう、回転を行うかに
かかわらず生の `rotationDeg` を `meta` に残す。

```diff
@@
-        return u && d && (this.#o = Vt(
+        return u && d && !this.#h.__unsafe_skipRotation__ && (this.#o = Vt(
@@
-        )), this.#s = Lt(
+        )), this.#s = Object.assign(Lt(
@@
-        ), this.#n.info("MP4Clip meta:", this.#s), { ...this.#s };
+        ), { rotationDeg: c.rotationDeg }), this.#n.info("MP4Clip meta:", this.#s), { ...this.#s };
```
