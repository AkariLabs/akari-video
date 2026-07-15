# 道具チェック

素材取得より前に実行する。3 つの道具の実在は宣言だけで済ませず、実際にコマンドを走らせて確認する。パスの存在を推測で報告しない。

## ffmpeg

```sh
command -v ffmpeg && ffmpeg -version | head -1
```

用途: 取得した broll / audio 素材の preview frame・waveform 抽出（[harvest-asset](../harvest-asset/SKILL.md) 4 節と同じ手順）、fetch した動画・音声の実体確認。

なければ: 導入コマンド（`brew install ffmpeg` 等）をユーザーに提示するだけに留める。エージェントが無断で環境変更を実行しない。

## whisper-cli（whisper.cpp）

実行ファイルとモデルは別々に確認する。探索順は [analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md) と揃える。

実行ファイル探索順:

1. 明示指定（`$AKARI_WHISPER_BIN` 等）があれば最優先
2. PATH 上の `whisper-cli`
3. リポジトリ内/隣接する whisper.cpp checkout の `build/bin/whisper-cli`

```sh
command -v whisper-cli && whisper-cli -h | head -5
```

モデル探索順（実行ファイルが見つかったときだけ確認する）:

1. 明示指定
2. リポジトリ内 `models/` / `whisper.cpp/models/`
3. `$HOME/.cache/whisper.cpp/`
4. `$HOME/Library/Caches/whisper.cpp/`
5. Homebrew `whisper-cpp` の share ディレクトリ
6. VoiceInk の保存先: `$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels/`

```sh
ls -la "$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels/" 2>/dev/null
```

用途: 取得した audio 素材のナレーション・歌詞有無の確認、fetch 後の内容チェック補助。素材ライブラリの主経路ではないため、無くても致命的ではない。

なければ: 文字起こしが絡む確認だけ省略し、他の工程は止めない。理由を報告する。

## headless Chrome

[overlay-authoring/thumbnail.md](../overlay-authoring/thumbnail.md) と同じ既定パスを使う。

```sh
CHROME="${AKARI_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
test -x "$CHROME" && echo "OK: $CHROME"
```

用途: 取得した telop / motion / 3d 系素材の `fragment.html` を実際にレンダーして preview.png を作る、または見た目を検品する。

なければ: 実体確認済みの preview 画像がカタログ側の `source.preview_url` にも無い限り、HTML 系素材の見た目確認を保留し理由を報告する。実物と違う mock を preview として作らない（[harvest-asset](../harvest-asset/SKILL.md) のよくある間違いを継承する）。

## Blender（条件付き — 3D ベイクレシピを扱うときだけ）

```sh
BLENDER="${AKARI_BLENDER_BIN:-}"
[ -z "$BLENDER" ] && BLENDER="$(command -v blender || true)"
[ -z "$BLENDER" ] && BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
test -x "$BLENDER" && "$BLENDER" --version | head -1
```

用途: 3d ベイクレシピ（`scene.py` 実体の素材）のヘッドレスレンダー。契約は `docs/contract-2026-07-14-3d-bake-recipe.md`、手順は [bake-3d/SKILL.md](../bake-3d/SKILL.md)。

なければ: 導入コマンド（`brew install --cask blender`）をユーザーに提示するだけに留める。3d ベイクが絡まない工程は止めない。常設 3 道具のチェック結果にも影響させない。

## 結果の扱い

- 3 つとも見つかった場合のみ「道具チェック OK」と報告する。
- 一部欠けている場合は、欠けている道具名と、それが後続のどの工程・どのカテゴリを制限するかを具体的に報告してから次の工程へ進む。工程全体は止めず、制限付きで進められる部分だけ進める。
- インストールコマンドをユーザーに無断で実行しない。

## よくある間違い

- 道具が入っているかを実行確認せず、パスの存在を推測で報告する。
- 欠けている道具を黙って別の代替（クラウド API 等）にすり替える。
- `brew install` 等をユーザー確認なしに実行する。
- whisper-cli はあるがモデルが無い状態を「OK」と報告する。
