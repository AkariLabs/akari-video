# タイムライン帯 keyed 差分化 性能検収ハーネス

内部リポ（`akari-video-internal`）の timeline-dom-vs-canvas-bench lab にある `gen-fixture.mjs`、`measure-a.mjs`、`launch-shell.sh`、`cdp-lib.mjs` をコピーしたハーネスです。内部 lab は読み取り専用の原本として変更しません。

この worktree 向けに次の 5 点を変更しています。

1. `launch-shell.sh` の `SHELL_DIR` と隔離ディレクトリの安全ガードを、この worktree と `evidence/strip-keyed-diff` 配下へ向けています。
2. `measure-a.mjs` のドラッグ候補の最小幅を 10 px から 4 px に緩め、候補選定前に帯の縦スクロール位置を最も多くの候補が表示域へ入る位置へ調整します。候補が無い場合は上端、中央、下端の順で試します。
3. 実行環境の shell パスをこの worktree に合わせ、`lib/frontend/bundle.js` の mtime・サイズと Git HEAD を実行時に記録します。また `--label=before|after` を結果の `label` に保存します。
4. `CDP.send()` の応答待ちを `AKARI_CDP_TIMEOUT_MS` で延長できるようにし、CDP domain の enable を最大 6 回、5 秒間隔で試します。
5. 計測開始、run の開始・終了、操作 2〜5 の各時点で load average を記録します。

## BEFORE / AFTER の計測

コマンドはこのディレクトリをカレントディレクトリにして実行します。N=200 と N=800 の fixture を用意したあと、起点 main のビルド成果物で BEFORE、本実装のビルド成果物で AFTER をそれぞれ 3 走ずつ計測します。

```sh
cd "$(git rev-parse --show-toplevel)/apps/shell/extensions/akari-annotations/evidence/strip-keyed-diff"

node scripts/gen-fixture.mjs --n=200
node scripts/gen-fixture.mjs --n=800

node scripts/measure-a.mjs --n=200,800 --output=before.json --label=before
node scripts/measure-a.mjs --n=200,800 --output=after.json --label=after
```

同居レーンの影響で負荷が高いときは、CDP 応答待ちを 60 秒へ延ばして実行します。

```sh
AKARI_CDP_TIMEOUT_MS=60000 node scripts/measure-a.mjs --n=200,800 --output=after.json --label=after
```

結果 JSON には、計測開始時、各 run の開始・終了時、操作 2〜5 の完了時点の load average が記録されます。性能値そのものとは分離し、計測条件として参照します。

`before.json` と `after.json` は `scripts/` の外に置き、追跡対象にします。fixture、run、console log、スクリーンショットなどの生成物は `.gitignore` で除外します。
