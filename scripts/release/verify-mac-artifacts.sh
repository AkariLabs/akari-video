#!/bin/bash
# macOS: verify both release containers and their root application bundles.
set -uo pipefail

if [[ $# -ne 2 || ! -f ${1:-} || ! -f ${2:-} ]]; then
  printf 'usage: bash %s <shell-mac.dmg> <shell-mac.zip>\n' "$0" >&2
  exit 2
fi

dmg=$1
zip=$2
mount_dir=''
zip_dir=''
mount_attempted=0
passed=0
total=0

cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n $mount_dir ]]; then
    if (( mount_attempted )); then
      if ! hdiutil detach "$mount_dir" >&2; then
        if ! hdiutil detach -force "$mount_dir" >&2; then
          # Never remove a directory that may still contain a mounted image.
          printf 'Could not detach %s\n' "$mount_dir" >&2
          mount_dir=''
          result=1
        fi
      fi
    fi
    [[ -z $mount_dir ]] || rm -rf -- "$mount_dir"
  fi
  [[ -z $zip_dir ]] || rm -rf -- "$zip_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

record() {
  local name=$1 result=$2 output=$3 line
  total=$((total + 1))
  if (( result == 0 )); then
    passed=$((passed + 1))
    printf 'PASS %s\n' "$name"
  else
    printf 'FAIL %s\n' "$name"
    while IFS= read -r line || [[ -n $line ]]; do
      printf '  | %s\n' "$line"
    done <<< "$output"
  fi
}

check() {
  local name=$1 mode=$2 output result
  shift 2
  output=$("$@" 2>&1)
  result=$?
  if [[ $mode == accepted || $mode == notarized ]]; then
    [[ $output == *accepted* ]] || result=1
  fi
  if [[ $mode == notarized ]]; then
    [[ $output == *'source=Notarized Developer ID'* ]] || result=1
  fi
  record "$name" "$result" "$output"
}

check_app() {
  local prefix=$1 directory=$2 error=$3
  local apps=()
  if [[ -z $error ]]; then
    shopt -s nullglob
    apps=("$directory"/*.app)
    shopt -u nullglob
    if [[ ${#apps[@]} -ne 1 || ! -d ${apps[0]} ]]; then
      error="Expected exactly one root .app directory in $directory; found ${#apps[@]}"
    fi
  fi
  if [[ -n $error ]]; then
    record "$prefix-codesign" 1 "$error"
    record "$prefix-spctl" 1 "$error"
    record "$prefix-stapler" 1 "$error"
    return
  fi
  check "$prefix-codesign" exit codesign --verify --deep --strict --verbose=2 "${apps[0]}"
  check "$prefix-spctl" notarized spctl -a -t exec -vv "${apps[0]}"
  check "$prefix-stapler" exit xcrun stapler validate "${apps[0]}"
}

check dmg-codesign exit codesign --verify --verbose=2 "$dmg"
check dmg-stapler exit xcrun stapler validate "$dmg"
check dmg-spctl accepted spctl -a -t open --context context:primary-signature -vv "$dmg"

prep_error=''
if mount_dir=$(mktemp -d 2>&1); then
  if output=$(hdiutil attach -nobrowse -readonly -noverify -mountpoint "$mount_dir" "$dmg" 2>&1); then
    mount_attempted=1
  else
    prep_error="hdiutil attach failed: $output"
  fi
else
  prep_error="mktemp failed: $mount_dir"
  mount_dir=''
fi
check_app dmg-app "$mount_dir" "$prep_error"

prep_error=''
if zip_dir=$(mktemp -d 2>&1); then
  if output=$(ditto -x -k "$zip" "$zip_dir" 2>&1); then
    :
  else
    prep_error="ditto extraction failed: $output"
  fi
else
  prep_error="mktemp failed: $zip_dir"
  zip_dir=''
fi
check_app zip-app "$zip_dir" "$prep_error"

printf 'summary: %s/%s\n' "$passed" "$total"
(( passed == total ))
