# @akari-video/direction

演出レシピ（`presets/direction/index.jsonl`）を既存の `edit.json` / `captions.json` への
追記パッチとして展開する CLI。契約の正本は
[`docs/contract-2026-08-06-direction-recipes-v0.md`](../../docs/contract-2026-08-06-direction-recipes-v0.md)。

外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。

## 使い方

パッチを確認するだけ（プロジェクトへは書き込まない）:

```sh
node bin/expand-direction.mjs neg-mono-popout --cut 0 --cut-in 3.0 --cut-out 6.5 --text "もう無理"
```

既存プロジェクトへ適用する（`<project>/edit.json` / `<project>/captions.json` を書き換える）:

```sh
node bin/expand-direction.mjs neg-mono-popout --cut 0 --project ./my-project --text "もう無理"
```

| オプション | 意味 |
|---|---|
| `--cut <n>` | 展開対象カットの index（必須） |
| `--lead-cut <n>` | `transition_in` を持つレシピの遷移元カット index（省略時 `cut-1`） |
| `--text <string>` | 画面に出す文言。省略時は文字レイヤーを展開しない |
| `--project <dir>` | 適用先プロジェクトルート。省略時は patch を stdout へ出力するだけ |
| `--audio-root <dir>` | AKARI Sounds 探索ルート（既定 `~/.akari/assets/audio`） |
| `--recipes <path>` | `index.jsonl` の場所（既定はリポルートの `presets/direction/index.jsonl`） |
| `--cut-in <sec>` / `--cut-out <sec>` | `--project` 省略時、patch 内容確認用に source in/out を明示指定 |
| `--cut-speed <n>` | `--project` 省略時、人物マット用に `cuts[].speed` を明示指定（既定 1） |
| `--source <path>` | `--project` 省略時、人物マット生成元のソースパスを明示指定 |
| `--fps <n>` | `--project` 省略時、人物マットの生成 fps を明示指定（既定 24） |

## 演者切り抜き（`neg-person-cutout`）

`neg-person-cutout` は重いマット生成を実行せず、次の 3 点を patch と `edit.json` に展開します。

- `layers_patch`: `kind: "video"`、`src: "assets/matte/person-<cut index>.webm"` の人物レイヤー。
  `t` は対象 cut のタイムライン開始、`duration` は `(out - in) / speed`。既存 `layers[]` の末尾へ追記する
- `timeline_tracks_patch`: 人物だけの layer track を新設し、下→上の配列末尾へ明示する
- `matte_prerequisite`: 速度適用済み区間の作成、person-matte の順序付き 2 ステップ

プロジェクト適用後、標準出力された patch の `matte_prerequisite.steps[]` を順に実行してから
render-cut します。第 1 step は対象区間に `setpts=PTS/<speed>` を適用し、出力 fps と
`(out-in)/speed` の `-t` でフレーム境界を固定した一時 MP4 を作ります。第 2 step はその MP4 を
[`skills/analyze-footage/bin/person-matte/person-matte.mjs`](../../skills/analyze-footage/bin/person-matte/person-matte.mjs)
へ渡し、最終形 `person-<cut index>.webm` を作ります。
`entrypoint_base: "akari_video_repo"` は script のパスをこのリポジトリ基準、その他の引数パスを
`path_base: "project"` に従いプロジェクト基準で解決する指定です。成功後は `cleanup[]` の一時 MP4 を
削除できます。最終成果物の WebM は削除しません。

`layers-alpha-decoder` で render-cut 側が VP9 alpha を直接デコードできるようになったため、
person-matte の WebM を変換せず `layers[].src` から直接参照します。

```sh
node bin/expand-direction.mjs neg-person-cutout --cut 2 --project ./my-project > /tmp/person-cutout-patch.json
# /tmp/person-cutout-patch.json の matte_prerequisite.steps を配列順に実行
```

人物レイヤーは専用 track かつ `layers[]` の末尾なので、同じ `layers[]` 内の上部マスク等より上に合成されます。
ただし HTML の `overlays[]` は現行 render-cut ではレイヤー合成後の別ステージに固定されており、
`timeline.tracks` で人物より下へ移せません。この制約は direction 契約 §3-7 に明記しています。

## 構成

- `src/recipes.mjs` — `index.jsonl` のパース・id 引き（純粋）
- `src/core.mjs` — `buildDirectionPatch()`。レシピ + 対象カット情報から patch を決定論で組み立てる（純粋・ファイル I/O なし）
- `src/apply.mjs` — patch を `edit.json` / `captions.json` オブジェクトへマージする（純粋）
- `src/sfx-resolve.mjs` — AKARI Sounds カタログから `se_default` id を実ファイルへ解決しコピーする（ファイル I/O あり）
- `bin/expand-direction.mjs` — 上記を束ねる CLI（ファイル I/O・引数パース）

## 決定論

`buildDirectionPatch()` は純関数。同一引数なら常にバイト等価な JSON を返す
（`test/core.test.mjs` / `test/cli.test.mjs` で検査）。`--project` 適用時のファイル書き込み
（SFX コピー等）は副作用だが、生成される patch オブジェクト自体の内容は決定論を保つ。

## v0 の既知のスコープ外

- `text.telop_preset`、`text.anim_in`/`anim_out`/`anim_loop`（textanim）は展開しない
  （契約書 §2-3・§3-5・§6。captions レール（`emphasis_words[].style_hint`）を実レンダ確認の上で
  優先経路として採用したため）
- `requires` を持つレシピは展開を拒否する（非 0 終了）
- `expand-direction` は人物マット生成を実行しない（`matte_prerequisite` の宣言だけを出す）
