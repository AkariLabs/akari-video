#!/bin/sh
set -eu

if [ "$#" -ne 5 ]; then
  echo "usage: launch-shell.sh <projectDir> <port> <isoDir> <logFile> <frameEngine 0|1>" >&2
  exit 2
fi

project_dir=$1
port=$2
iso_dir=$3
log_file=$4
frame_engine=$5

case "$frame_engine" in
  0|1) ;;
  *) echo "frameEngine must be 0 or 1" >&2; exit 2 ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
repository_root=$(CDPATH= cd -- "$script_dir/../../../../../.." && pwd -P)
shell_dir="$repository_root/apps/shell"
electron="$shell_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$electron" ]; then
  echo "Electron executable not found: $electron" >&2
  exit 1
fi
if [ ! -f "$project_dir/edit.json" ]; then
  echo "fixture edit.json not found: $project_dir/edit.json" >&2
  exit 1
fi

mkdir -p "$iso_dir" "$(dirname -- "$log_file")"
AKARI_FRAME_ENGINE="$frame_engine" THEIA_CONFIG_DIR="$iso_dir" \
  nohup "$electron" "$shell_dir" "$project_dir" \
    "--remote-debugging-port=$port" "--user-data-dir=$iso_dir" --no-sandbox \
    --disable-features=MacWebContentsOcclusion >"$log_file" 2>&1 &
electron_pid=$!
nohup caffeinate -d -i -m -s -u -w "$electron_pid" >/dev/null 2>&1 &
echo "$electron_pid"
