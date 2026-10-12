# Tool checks

Run before acquiring assets. Verify the 3 tools by actually running commands, not merely declaring availability. Do not report guessed paths as existing.

## Installing on the user's behalf (approval required)

For missing tools, **only with explicit user approval**, you may install rather than just present instructions. Without approval, only show installation commands as before; never run `brew install` or similar without permission (hard rule, invariant).

Use the same installation conventions as the AKARI Video app's first-run installation engine. **Official channels only**:

- Use brew when available (`brew install ffmpeg` / `brew install whisper-cpp`).
- Put yt-dlp's standalone binary from official GitHub releases in `~/.akari/tools/bin/`.
- Put Whisper models from the official distribution (Hugging Face `ggerganov/whisper.cpp`) in `~/.akari/tools/models/`.
- Never acquire from unofficial distributions or untrusted mirrors.

Installation directories (`~/.akari/tools/bin/` / `~/.akari/tools/models/`) are shared with the app's acquisition route.
**The app's first-run setup screen can also install the same tools with checkboxes + an Install button**;
agent and app installation converge on the same location.

After installing, **always recheck by executing the tool** before reporting results. If neither brew, bundled tools,
nor official channels are available, explain that updating AKARI Video may provide bundled tools and limit yourself to showing installation commands.

## ffmpeg

Search order (aligned with executable resolution in [analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md)):

1. Explicit setting: `$AKARI_FFMPEG_BIN`
2. Packaged app bundle: `Resources/media-bin/ffmpeg` (default macOS install: `/Applications/AKARI Video.app/Contents/Resources/media-bin/ffmpeg`; Windows: `Resources/media-bin/ffmpeg.exe`)
3. Repository development: `packages/media-bin/vendor/<platform>-<arch>/ffmpeg` (example: `packages/media-bin/vendor/darwin-arm64/ffmpeg`)
4. `ffmpeg` on PATH

```sh
BUNDLED="/Applications/AKARI Video.app/Contents/Resources/media-bin/ffmpeg"
DEV_VENDOR="packages/media-bin/vendor/$(node -e "console.log(process.platform+'-'+process.arch)")/ffmpeg"
FFMPEG_BIN="${AKARI_FFMPEG_BIN:-}"
[ -z "$FFMPEG_BIN" ] && [ -x "$BUNDLED" ] && FFMPEG_BIN="$BUNDLED"
[ -z "$FFMPEG_BIN" ] && [ -x "$DEV_VENDOR" ] && FFMPEG_BIN="$DEV_VENDOR"
[ -z "$FFMPEG_BIN" ] && FFMPEG_BIN="$(command -v ffmpeg || true)"
[ -n "$FFMPEG_BIN" ] && "$FFMPEG_BIN" -version | head -1
```

Purpose: Extract preview frames / waveforms from acquired broll / audio assets (same procedure as [harvest-asset](../harvest-asset/SKILL.md) §4); verify fetched video/audio files.

If missing: Before approval, only present the installation command (`brew install ffmpeg`). With approval, install via brew and recheck. If neither brew nor bundled tools exist, explain that updating AKARI Video may provide bundled tools.

## whisper-cli (whisper.cpp)

Check executable and model separately. Align search order with [analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md).

Executable search order:

1. Explicit setting (such as `$AKARI_WHISPER_BIN`)
2. Packaged app bundle: `Resources/media-bin/whisper-cli` (default macOS install: `/Applications/AKARI Video.app/Contents/Resources/media-bin/whisper-cli`; Windows: `.exe`). Detect if bundled. A parallel task is adding media-bin supply for whisper-cli; this skill must not assert availability.
3. Repository development: `packages/media-bin/vendor/<platform>-<arch>/whisper-cli`
4. `$HOME/.akari/tools/bin/whisper-cli` (where the app and this skill's approved installer place it without brew; shared with the app)
5. `whisper-cli` on PATH
6. `build/bin/whisper-cli` in a whisper.cpp checkout within or adjacent to the repository

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

Model search order (check only after finding the executable):

1. Explicit setting
2. `$HOME/.akari/tools/models/` (default location for official models acquired by app first-run setup or this skill's approved installer; default model `ggml-large-v3-turbo-q5_0.bin`, about 574MB)
3. Repository `models/` / `whisper.cpp/models/`
4. `$HOME/.cache/whisper.cpp/`
5. `$HOME/Library/Caches/whisper.cpp/`
6. Homebrew `whisper-cpp` share directory
7. VoiceInk storage: `$HOME/Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels/`

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

If missing: Without the executable, skip only transcription-related checks, not other stages. If the executable exists but no model does, obtain approval to acquire the default model from the official Hugging Face `ggerganov/whisper.cpp` repository into `~/.akari/tools/models/`. Without approval, only present the source. After acquisition, calculate sha256 and retain it in the report (use the same primary source for pinned URLs and sha256 constants as the app's acquisition logic).

Purpose: Check acquired audio assets for narration/lyrics and assist post-fetch content checks. This is not the asset library's main route, so absence is not fatal.

## Blender (conditional — only for 3D bake recipes)

```sh
BLENDER="${AKARI_BLENDER_BIN:-}"
[ -z "$BLENDER" ] && BLENDER="$(command -v blender || true)"
[ -z "$BLENDER" ] && BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
test -x "$BLENDER" && "$BLENDER" --version | head -1
```

Purpose: Headless rendering of 3d bake recipes (assets whose actual file is `scene.py`). Contract: `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-14-3d-bake-recipe.md`; procedure: [bake-3d/SKILL.md](../bake-3d/SKILL.md).

If missing: Before approval, only present the installation command (`brew install --cask blender`). With approval, install via brew and recheck. Do not stop stages unrelated to 3d baking or affect the check results for the 3 regular tools.

## Handling results

- Report tool checks OK only if all 3 are found.
- If some are missing, explicitly report their names and the later stages/categories they constrain before proceeding. Do not stop the entire workflow; proceed only with what remains possible under those limits.
- Do not run installation commands without approval.

## Common mistakes

- Reporting guessed paths without executing the tools to check installation.
- Silently substituting alternatives (such as cloud APIs) for missing tools.
- Running `brew install` or similar without approval.
- Reporting OK when whisper-cli exists but its model does not.
- Reporting OK after approved installation without rechecking.
- Acquiring tools/models from unofficial channels such as untrusted mirrors.
