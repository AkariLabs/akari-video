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

`VideoFrameFinder` が `null` を返す分岐を実測できるよう、既定 no-op の診断フック `globalThis.__akariFinderTrace` を追加する。フックが関数のときだけ内部スナップショットと理由を通知し、フック側の例外は finder の挙動へ伝播させない。

```diff
@@
   #c = 0;
   #d = !1;
+  /* AKARI patch: expose opt-in VideoFrameFinder null-return diagnostics. */
   #m = async (t, e, i) => {
-    if (e == null || e.state === "closed" || i.abort) return null;
+    if (e == null || e.state === "closed" || i.abort) {
+      const n = globalThis.__akariFinderTrace;
+      if (typeof n === "function") try {
+        const { memInfo: a, ...r } = this.#p();
+        n({
+          reason: "decoder-unavailable",
+          ...r,
+          decoderNull: e == null,
+          decoderClosed: e?.state === "closed",
+          aborted: i.abort,
+          at: performance.now()
+        });
+      } catch {
+      }
+      return null;
+    }
     if (this.#i.length > 0) {
       const n = this.#i[0];
-      return t < n.timestamp ? null : (this.#i.shift(), t > n.timestamp + (n.duration ?? 0) ? (n.close(), await this.#m(t, e, i)) : (!this.#d && this.#i.length < 10 && this.#f(e).catch((a) => {
+      if (t < n.timestamp) {
+        const a = globalThis.__akariFinderTrace;
+        if (typeof a === "function") try {
+          const { memInfo: r, ...o } = this.#p();
+          a({
+            reason: "cache-head-after-target",
+            ...o,
+            headTimestamp: n.timestamp,
+            at: performance.now()
+          });
+        } catch {
+        }
+        return null;
+      }
+      return this.#i.shift(), t > n.timestamp + (n.duration ?? 0) ? (n.close(), await this.#m(t, e, i)) : (!this.#d && this.#i.length < 10 && this.#f(e).catch((a) => {
         throw this.#d = !0, this.#h(t), a;
-      }), n));
+      }), n);
@@
-      if (this.#r >= this.samples.length)
+      if (this.#r >= this.samples.length) {
+        const n = globalThis.__akariFinderTrace;
+        if (typeof n === "function") try {
+          const { memInfo: a, ...r } = this.#p();
+          n({
+            reason: "eos-no-more-samples",
+            ...r,
+            at: performance.now()
+          });
+        } catch {
+        }
         return null;
+      }
```

最終 GOP の全サンプル投入後、`decodeQueueSize` が 0 でも並べ替え待ちの出力コールバックが残る場合があるため、EOS で即座に `null` を返す前に `flush()` の完了を 1 回だけ待つ。高負荷・8 並列のストレス試験では 104 試行中 26 件で末尾 1〜5 コマが欠落し、その全件が `decCusorIdx == sampleLen`、`outputCnt < inputCnt`、`cacheFrameLen == 0` の EOS 分岐だった。従来の待機条件は `decodeQueueSize > 0` を要求していたためこの状態を待てず、最終 GOP に残った並べ替えフレームを回収できなかった。

```diff
@@
       if (this.#r >= this.samples.length) {
+        /* AKARI patch: drain reordered tail frames before reporting end of stream. */
+        if (!i.drained && e.state === "configured" && this.#o < this.#l) {
+          i.drained = !0;
+          const n = globalThis.__akariFinderTrace;
+          if (typeof n === "function") try {
+            const { memInfo: a, ...r } = this.#p();
+            n({ reason: "eos-drain", ...r, at: performance.now() });
+          } catch {
+          }
+          try {
+            await e.flush();
+          } catch (a) {
+            if (!(a instanceof Error) || !a.message.includes("Aborted due to close"))
+              throw a;
+          }
+          if (i.abort || e.state === "closed") {
+            const a = globalThis.__akariFinderTrace;
+            if (typeof a === "function") try {
+              const { memInfo: r, ...o } = this.#p();
+              a({
+                reason: "decoder-unavailable",
+                ...o,
+                decoderNull: !1,
+                decoderClosed: e.state === "closed",
+                aborted: i.abort,
+                at: performance.now()
+              });
+            } catch {
+            }
+            return null;
+          }
+          return await this.#m(t, e, i);
+        }
         const n = globalThis.__akariFinderTrace;
```

上流へ戻すときは、この max 算出が取り込まれた版へ更新して vendor と相対 import を外す。`videoDeltaTS = samples[0].dts` を `elst.media_time` にする件は別問題として扱う。
