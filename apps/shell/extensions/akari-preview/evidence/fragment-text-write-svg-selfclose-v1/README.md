# SVG 自己終了タグと断片の文字保存

同梱サンプルの HTML 断片で文字を 1 文字足したとき、SVG の `<path/>` などが webview の `outerHTML` で `<path></path>` になっても、元の断片ファイルには文字だけを保存できるかを確かめる L1 証跡。シェル実機と Web UI の保存経路を測る。

## 実行

リポジトリのルートで `cd apps/shell && npm run build` を済ませ、以下を実行する。

```sh
apps/shell/extensions/akari-preview/evidence/fragment-text-write-svg-selfclose-v1/scripts/run-l1.sh before
apps/shell/extensions/akari-preview/evidence/fragment-text-write-svg-selfclose-v1/scripts/run-l1.sh after
AKARI_FTW_VARIANT=elements apps/shell/extensions/akari-preview/evidence/fragment-text-write-svg-selfclose-v1/scripts/run-l1.sh after
apps/shell/extensions/akari-preview/evidence/fragment-text-write-svg-selfclose-v1/scripts/run-webui.sh before
apps/shell/extensions/akari-preview/evidence/fragment-text-write-svg-selfclose-v1/scripts/run-webui.sh after
```

`AKARI_FTW_OUT_DIR` は結果の出力先、`AKARI_CDP_PORT` は Electron の CDP ポート、`AKARI_WEBUI_PORT` は Web UI のポート、`AKARI_FTW_ONLY` は対象断片の絞り込みに使う。`ELECTRON_BIN` と `AKARI_SHELL_DIR` で実行バイナリとシェルの場所を指定できる。既定の出力先はシステムの一時ディレクトリ内。この証跡には JSON の記録だけを置く。

フィクスチャは製品のオンボーディングの `writeExample`（段階 8）が作る同梱サンプルのプロジェクト。準備時に断片が同梱ファイルとバイト一致することを検査する。webview の `engine.overlayWrite` を包み、実際に送られた HTML を記録する。`tag-ruler.mjs` は製品コードと独立に元と送信後のタグの並びを数える。after では編集した行が 1 行で、変わった各行には足した 1 文字だけが入ったことを検査する。ミラー層 `data-mirror="text"` を持つ断片では、その行にも同じ文字が入る。demo-effects は編集した行 1 行とミラー層 2 行の計 3 行が変わる。最後に、確定の直前に SVG 内へ `<circle>` を 1 つ足す本当の構造変化を試し、拒否メッセージに最初の違いが出て断片が書き換わらないことも見る。

## before（シェル・plain）

| 断片 | 結果 | 最初の違い（元 / 編集後） |
|---|---|---|
| demo-bgm-chip | 拒否 | 10 番目・`<rect>` / `</ellipse>` |
| demo-chat | 拒否 | 8 番目・`</svg>` / `</path>` |
| demo-credit | HTML 文字の対象なし（スロットのみ） | — |
| demo-diagram | 拒否 | 12 番目・`</svg>` / `</path>` |
| demo-done | HTML 文字の対象なし（スロットと SVG text） | — |
| demo-effects | 拒否 | 249 番目・`<path>` / `</path>` |
| demo-flash | 文字の対象なし | — |
| demo-phone | 拒否 | 21 番目・`</svg>` / `</path>` |
| demo-title | 拒否 | 25 番目・`<path>` / `</rect>` |

before の `elements` 変種でも demo-bgm-chip と demo-title は拒否された。Web UI の demo-title は `PUT /api/overlay-html` が 422 を返した。詳細は `results/` の 3 つの JSON にある。

before の記録は、ミラー層の判定と構造変化の手順を加える前のスクリプトで取った。before は記録だけなので測り方は同じ。`shell_dir` と `electron` はリポジトリからの相対パスに直してある。

demo-diagram は最初に試した小さい文字（`demo-diagram__title`、画面上約 47×9px）ではダブルクリックで編集に入れなかった。1 回目のクリックで出る要素枠の辺ハンドルが文字の中心に重なるため、2 つ目の文字で測った。before / after とも同じで、`text.failedAttempts` に記録されている。本票の対象外。

## after（実測）

記録は `results/run-log-after-plain.json`・`results/run-log-after-elements.json`・`results/run-log-webui-after.json`。各ファイルの全体 `status` はいずれも **PASS**。

### シェル plain（9 本）

| 断片 | `text.result` | `editedLines` | `mirrorLines` | `onlyInsertedCharacter` | `records[].status` |
|---|---|---:|---:|---|---|
| demo-bgm-chip | saved | 1 | 0 | true | ok |
| demo-chat | saved | 1 | 0 | true | ok |
| demo-credit | no-target | — | — | — | ok |
| demo-diagram | saved | 1 | 0 | true | ok |
| demo-done | no-target | — | — | — | ok |
| demo-effects | saved | 1 | 2 | true | ok |
| demo-flash | no-target | — | — | — | ok |
| demo-phone | saved | 1 | 0 | true | ok |
| demo-title | saved | 1 | 0 | true | ok |

### シェル elements（2 本）

| 断片 | `text.result` | `editedLines` / `mirrorLines` / `onlyInsertedCharacter` | `elementsPreserved` | `text.overrideInSentHtml` | `text.overrideInFragmentFile` | `records[].status` |
|---|---|---|---|---|---|---|
| demo-bgm-chip | saved | 1 / 0 / true | true | true | false | ok |
| demo-title | saved | 1 / 0 / true | true | true | false | ok |

### Web UI

| 断片 | `put.status` | `fragmentDiff.changedLines` | `fragmentDiff.sameLineCount` | `fragmentDiff.onlyInsertedCharacter` | 全体 `status` |
|---|---:|---:|---|---|---|
| demo-title | 200 | 1 | true | true | PASS |

### 本当の構造変化

シェル plain の `structureChange` は `result: refused`・`status: ok`、バナーと `message` が一致し、`fragmentChanged: false`。`structureChange.message`:

```text
断片の構造が変わったため、元ソースの文字だけを安全に保存できません（最初の違い: 28 番目・元 </svg> / 編集後 <circle>）
```

Web UI の `structureChange` は PUT 422・`fragmentUnchanged: true`。`structureChange.body.error`:

```text
断片の構造が変わったため、元ソースの文字だけを安全に保存できません（最初の違い: 28 番目・元 </svg> / 編集後 <circle>）
```
