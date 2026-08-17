# 道具チェック

素材取得より前に実行する。3 つの道具の実在は宣言だけで済ませず、実際にコマンドを走らせて確認する。パスの存在を推測で報告しない。

## 導入代行について（承認が前提）

欠けている道具は、**ユーザーの明示承認を得た場合に限り**、提示に留めず導入まで代行してよい。承認が無ければ従来どおり導入コマンドの提示止まりとし、`brew install` 等を無断で実行しない（ハードルール・不変）。

導入手段は AKARI Video アプリ本体（初回セットアップ画面）のインストールエンジンと同一の規約に揃える。**公式チャネルのみ**:

- brew が使えるなら brew（`brew install ffmpeg` / `brew install whisper-cpp`）
- yt-dlp は公式 GitHub releases の単体バイナリを `~/.akari/tools/bin/` へ
- whisper モデルは公式配布（Hugging Face `ggerganov/whisper.cpp`）から `~/.akari/tools/models/` へ
- 野良ミラー・非公式配布からの取得は行わない

導入先ディレクトリ（`~/.akari/tools/bin/` / `~/.akari/tools/models/`）はアプリ側の取得経路と共有している。**アプリの初回セットアップ（はじめる準備）画面からも、同じ道具をチェックボックス + インストールボタンで導入できる** — エージェント経由でもアプリ経由でも、結果は同じ置き場に揃う。

導入を実行したら、提示だけで終わらせず**必ず再チェック**（実行確認）してから結果を報告する。brew も同梱も公式チャネルも無い場合は、AKARI Video アプリを最新版に更新すると同梱される可能性がある旨を案内し、導入コマンドの提示に留める。

## ffmpeg

探索順（[analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md) の ffmpeg 実体解決と揃える）:

1. 明示指定: `$AKARI_FFMPEG_BIN`
2. パッケージ版アプリの同梱: `Resources/media-bin/ffmpeg`（macOS 既定インストール: `/Applications/AKARI Video.app/Contents/Resources/media-bin/ffmpeg`。Windows は `Resources/media-bin/ffmpeg.exe`）
3. リポ開発時: `packages/media-bin/vendor/<platform>-<arch>/ffmpeg`（例 `packages/media-bin/vendor/darwin-arm64/ffmpeg`）
4. PATH 上の `ffmpeg`

```sh
BUNDLED="/Applications/AKARI Video.app/Contents/Resources/media-bin/ffmpeg"
DEV_VENDOR="packages/media-bin/vendor/$(node -e "console.log(process.platform+'-'+process.arch)")/ffmpeg"
FFMPEG_BIN="${AKARI_FFMPEG_BIN:-}"
[ -z "$FFMPEG_BIN" ] && [ -x "$BUNDLED" ] && FFMPEG_BIN="$BUNDLED"
[ -z "$FFMPEG_BIN" ] && [ -x "$DEV_VENDOR" ] && FFMPEG_BIN="$DEV_VENDOR"
[ -z "$FFMPEG_BIN" ] && FFMPEG_BIN="$(command -v ffmpeg || true)"
[ -n "$FFMPEG_BIN" ] && "$FFMPEG_BIN" -version | head -1
```

用途: 取得した broll / audio 素材の preview frame・waveform 抽出（[harvest-asset](../harvest-asset/SKILL.md) 4 節と同じ手順）、fetch した動画・音声の実体確認。

なければ: 承認前は導入コマンド（`brew install ffmpeg`）の提示に留める。承認があれば brew 経由で導入し、再チェックする。brew も同梱も無ければ、AKARI Video アプリを最新版に更新すると同梱される可能性がある旨を案内する。

## whisper-cli（whisper.cpp）

実行ファイルとモデルは別々に確認する。探索順は [analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md) と揃える。

実行ファイル探索順:

1. 明示指定（`$AKARI_WHISPER_BIN` 等）
2. パッケージ版アプリの同梱: `Resources/media-bin/whisper-cli`（macOS 既定インストール: `/Applications/AKARI Video.app/Contents/Resources/media-bin/whisper-cli`。Windows は `.exe`）— 同梱されていれば検出される。whisper-cli の media-bin 供給は並走タスクが追加中で、本スキルは存在を断定しない
3. リポ開発時: `packages/media-bin/vendor/<platform>-<arch>/whisper-cli`
4. `$HOME/.akari/tools/bin/whisper-cli`（アプリの導入代行・本スキルの承認付き導入代行が brew 不在時に配置する置き場。アプリ側と共有）
5. PATH 上の `whisper-cli`
6. リポジトリ内/隣接する whisper.cpp checkout の `build/bin/whisper-cli`

```sh
BUNDLED="/Applications/AKARI Video.app/Contents/Resources/media-bin/whisper-cli"
DEV_VENDOR="packages/media-bin/vendor/$(node -e "console.log(process.platform+'-'+process.arch)")/whisper-cli"
TOOLS_BIN="$HOME/.akari/tools/bin/whisper-cli"
WHISPER_BIN="${AKARI_WHISPER_BIN:-}"
[ -z "$WHISPER_BIN" ] && [ -x "$BUNDLED" ] && WHISPER_BIN="$BUNDLED"
[ -z "$WHISPER_BIN" ] && [ -x "$DEV_VENDOR" ] && WHISPER_BIN="$DEV_VENDOR"
[ -z "$WHISPER_BIN" ] && [ -x "$TOOLS_BIN" ] && WHISPER_BIN="$TOOLS_BIN"
[ -z "$WHISPER_BIN" ] && WHISPER_BIN="$(command -v whisper-cli || true)"
[ -n "$WHISPER_BIN" ] && "$WHISPER_BIN" -h | head -5
```

モデル探索順（実行ファイルが見つかったときだけ確認する）:

1. 明示指定
2. `$HOME/.akari/tools/models/`（アプリの初回セットアップ・本スキルの承認付き導入代行が公式配布から取得する既定置き場。既定モデルは `ggml-large-v3-turbo-q5_0.bin` 約 574MB）
3. リポジトリ内 `models/` / `whisper.cpp/models/`
4. `$HOME/.cache/whisper.cpp/`
5. `$HOME/Library/Caches/whisper.cpp/`
6. Homebrew `whisper-cpp` の share ディレクトリ
7. VoiceInk の保存先: `$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels/`

```sh
MODEL_ROOTS=(
  "$HOME/.akari/tools/models"
  "models"
  "whisper.cpp/models"
  "$HOME/.cache/whisper.cpp"
  "$HOME/Library/Caches/whisper.cpp"
)
if command -v brew >/dev/null && BREW_PREFIX="$(brew --prefix whisper-cpp 2>/dev/null)"; then
  MODEL_ROOTS+=("$BREW_PREFIX/share/whisper-cpp")
fi
MODEL_ROOTS+=("$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels")

for model_root in "${MODEL_ROOTS[@]}"; do
  [ -d "$model_root" ] || continue
  find "$model_root" -type f -name 'ggml-*.bin' -not -name 'for-tests-*' -print
done
```

なければ: 実行ファイルが無ければ文字起こしが絡む確認だけ省略し、他の工程は止めない。実行ファイルはあるがモデルが無い場合は、承認を得て公式配布（Hugging Face `ggerganov/whisper.cpp` リポジトリ）から既定モデルを `~/.akari/tools/models/` へ取得できる。承認が無ければ取得元の提示に留める。取得後は sha256 を計算して報告に残す（版固定 URL・sha256 定数の一次ソースはアプリ側の取得ロジックと同一のものを使う）。

用途: 取得した audio 素材のナレーション・歌詞有無の確認、fetch 後の内容チェック補助。素材ライブラリの主経路ではないため、無くても致命的ではない。

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

なければ: 承認前は導入コマンド（`brew install --cask blender`）の提示に留める。承認があれば brew 経由で導入し、再チェックする。3d ベイクが絡まない工程は止めない。常設 3 道具のチェック結果にも影響させない。

## 結果の扱い

- 3 つとも見つかった場合のみ「道具チェック OK」と報告する。
- 一部欠けている場合は、欠けている道具名と、それが後続のどの工程・どのカテゴリを制限するかを具体的に報告してから次の工程へ進む。工程全体は止めず、制限付きで進められる部分だけ進める。
- 承認なしにインストールコマンドを実行しない。

## よくある間違い

- 道具が入っているかを実行確認せず、パスの存在を推測で報告する。
- 欠けている道具を黙って別の代替（クラウド API 等）にすり替える。
- 承認なしに `brew install` 等を実行する。
- whisper-cli はあるがモデルが無い状態を「OK」と報告する。
- 承認を得て導入したのに再チェックせず「OK」と報告する。
- 公式チャネル以外（野良ミラー等）から道具・モデルを取得する。
