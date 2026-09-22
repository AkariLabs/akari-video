#!/bin/sh
# usage: launch.sh <apps/shell 絶対パス> <tag>  — 隔離 user-data / AKARI_HOME で Electron を CDP 9451 起動し PID を /tmp/chrome-emphasis-and-home-tab-l1/<tag>.pid へ
set -e
SHELL_DIR="$1"; TAG="$2"; ROOT=/tmp/chrome-emphasis-and-home-tab-l1
mkdir -p "$ROOT/$TAG/home" "$ROOT/$TAG/theia" "$ROOT/$TAG/ud"
if [ ! -d "$ROOT/ws" ]; then
  cp -R "$SHELL_DIR/../../templates/project-default" "$ROOT/ws"
  echo '{"version":1,"tracks":[]}' > "$ROOT/ws/edit.json"
  echo '{"captions":[]}' > "$ROOT/ws/captions.json"
  echo '# memo' > "$ROOT/ws/planning/memo.md"
  for i in $(seq -w 1 16); do echo "# note $i" > "$ROOT/ws/planning/note-$i.md"; done
fi
# THEME=light でユーザー設定にテーマを書いてから起動する
[ -n "$THEME" ] && printf '{"workbench.colorTheme": "%s"}\n' "$THEME" > "$ROOT/$TAG/theia/settings.json"
AKARI_HOME="$ROOT/$TAG/home" THEIA_CONFIG_DIR="$ROOT/$TAG/theia" \
  "$SHELL_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$SHELL_DIR" "$ROOT/ws" \
  --remote-debugging-port=${CDP_PORT:-9451} --user-data-dir="$ROOT/$TAG/ud" --no-sandbox --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling > "$ROOT/$TAG.log" 2>&1 &
echo $! > "$ROOT/$TAG.pid"; echo "pid $(cat $ROOT/$TAG.pid)"
