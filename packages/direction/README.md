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
