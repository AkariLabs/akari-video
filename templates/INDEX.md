# テンプレート — プロジェクトの出発点

ここは**プロジェクト作成時に 1 回だけ丸ごとコピーするもの**を置く場所です。素材ライブラリ
（[assets/](../assets/INDEX.md) — 使うたびに 1 個ずつコピーする部品）とも、参照表
（[presets/](../presets/INDEX.md) — コードが id で引くだけでコピーしない）とも別の棚です。

中には**性質の違う 2 種類**が入っています。混ぜて扱うと事故るので、先に見分けてください。

| | [project-default](./project-default/) | [kaisetsu-short](./kaisetsu-short/README.ja.md) |
|---|---|---|
| 何か | **器** — プロジェクトの初期構造（空） | **作例** — 完成した制作フロー一式 |
| 中身 | `assets/` `planning/` `exports/` + `CLAUDE.md` / `AGENTS.md` / `.akari/` / `.claude/` | 構成 HTML + ツール 5 本 + QA チェックリスト + サンプル台本 + プレースホルダ素材 |
| 誰が使うか | **コードとスキル**（`create-project` スキル・`akari-launcher` CLI・シェルのプロジェクト作成・パッケージング時のコピー） | **人 / AI が読んで複製する**（自動参照はされない） |
| 壊すとどうなるか | `create-project` が壊れる。`packages/project-scaffold` のテストが落ちる | 誰も気づかない（参照ゼロのため） |
| 位置づけ | **製品の一部** | **ドキュメント寄りの作例** |

この差が実務上いちばん効くのは 4 行目です。`project-default` は**触ると製品が壊れる**ので、
変更時は `packages/project-scaffold/test/create-project.test.mjs` と
`packages/schemas/test/validate-connections.test.mjs`（`.akari/connections.json` を実物で検証）を
必ず走らせてください。`kaisetsu-short` は自己完結しているので、壊しても影響範囲はその中だけです。

## project-default — プロジェクトの器

新規プロジェクトの初期構造です。`create-project` スキルが再帰コピーし、雛形バージョンを記録します。

```sh
node skills/create-project/bin/create-project.mjs <target-dir>
```

契約は [`docs/contract-2026-07-25-project-structure-v0.md`](../docs/contract-2026-07-25-project-structure-v0.md)。
`--template <path>` で別の雛形を指定できますが、**解決経路はこの 2 択のみ**です（スキルのハードルール 1）。

## kaisetsu-short — 解説ショートの作例

3 面構成（タイトル / 図解 / エンディング）の縦ショート解説動画を、**台本 JSON の差し替えだけで
次が作れる**状態にした一式です。キャラクターが口パク + 表情で話しながら図解カードを段階表示する、
VOICEVOX ナレーション駆動の決定論レンダリング（ブラウザ合成 → フレームキャプチャ → mux）。

まず動かして確かめるなら、同梱のサンプル（ナレーション音声も同梱のため VOICEVOX 不要）:

```sh
cd templates/kaisetsu-short
node tools/build.mjs sample-project --no-synthesize
```

使い方の詳細は [kaisetsu-short/README.ja.md](./kaisetsu-short/README.ja.md)。

**`create-project --template` に渡す用途ではありません。** これはプロジェクトの器ではなく
制作フローの作例なので、`.akari/` などの器の構造を持っていません。使うときはディレクトリごと
複製し、`sample-project/` を自分の台本で置き換えてください。

## 追加するとき

新しく足すものが**器**（コードが参照する初期構造）なのか**作例**（人が複製して改造する完成品）なのかを
先に決めて、この INDEX の表に 1 行足してください。作例が 2 つ目・3 つ目と増えたら、
`templates/examples/` へまとめる判断をします（1 つのうちは階層を足しません）。
