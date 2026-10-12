#!/usr/bin/env bash
# AKARI Video — main entry point
set -euo pipefail

MUTED='\033[0;2m'; RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[38;5;214m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

# Match the CLI's explicit override and the macOS system language, even when
# the terminal uses a different LANG. This also works before Node is installed.
shell_language() {
  local locale="${AKARI_LANG:-}"
  if [[ -z "$locale" ]] && [[ "$(uname -s)" == "Darwin" ]] && command -v defaults >/dev/null 2>&1; then
    locale="$(defaults read -g AppleLanguages 2>/dev/null | sed -n 's/^[[:space:]]*"*\([[:alpha:]]\{2,3\}\).*/\1/p' | head -n 1)" || true
  fi
  locale="${locale:-${LANG:-en}}"
  case "$locale" in ja*|JA*|Ja*|jA*) echo ja ;; *) echo en ;; esac
}
SHELL_LANGUAGE="$(shell_language)"
user_text() { if [[ "$SHELL_LANGUAGE" == ja ]]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

# ─── Resolve script location (works via PATH/symlink) ───
SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
ORIGINAL_ARGS=("$@")

# ─── Find monorepo root ───
find_monorepo() {
  local dir; dir="$(cd "$(dirname "$1")" && pwd)"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/packages/akari-launcher/bin/akari.mjs" ]]; then echo "$dir"; return 0; fi
    dir="$(dirname "$dir")"
  done
  if [[ -n "${AKARI_MONOREPO:-}" ]] && [[ -f "$AKARI_MONOREPO/packages/akari-launcher/bin/akari.mjs" ]]; then
    echo "$AKARI_MONOREPO"; return 0
  fi
  # Detect installations made by install.sh, including projects moved to a new computer.
  local install_dir="${AKARI_INSTALL_DIR:-$HOME/.akari/app}"
  if [[ -f "$install_dir/packages/akari-launcher/bin/akari.mjs" ]]; then
    echo "$install_dir"; return 0
  fi
  return 1
}

# ─── Recover when the app or Node is missing or unusable. Avoid technical jargon
#     (Node / monorepo / PATH / env) and ask one setup question.
#     On approval, run the installer and retry the original command.
#     On refusal or without a TTY (CI / pipe), print one guidance line
#     and exit 1, following the install.sh /dev/tty guard. ───
INSTALL_ONE_LINER='curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash'

show_setup_guide() {
  warn "$(user_text "セットアップするには次を実行してください: $INSTALL_ONE_LINER" "To set up AKARI Video, run: $INSTALL_ONE_LINER")"
}

run_self_heal_installer() {
  if [[ -n "${AKARI_SELF_HEAL_INSTALLER:-}" ]]; then
    # Test hook: run a supplied command instead of using the network.
    bash -c "$AKARI_SELF_HEAL_INSTALLER"
  else
    curl -fsSL "https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh" | bash
  fi
}

self_heal_and_reexec() {
  if [[ -n "${AKARI_SELF_HEAL_ATTEMPTED:-}" ]]; then
    err "$(user_text 'セットアップを試みましたが、まだ利用できる状態になっていません。お手数ですが上記コマンドを手動で実行するか、サポートにご相談ください。' 'Setup was attempted, but AKARI Video is still unavailable. Please run the command above manually or contact support.')"
    show_setup_guide
    exit 1
  fi

  # Check whether the controlling terminal can actually be opened; permission bits
  # always appear rw, so a preliminary check is unreliable. Follow the install.sh
  # /dev/tty guard. A bare `exec 3<>/dev/tty 2>/dev/null` (without a command)
  # leaves stderr redirected to /dev/null for the rest of the shell process
  # because exec changes the current shell file descriptors.
  # That also hides the `read -p` prompt, which writes to fd 2, making the
  # command appear stuck. Save fd 2 only for the open attempt and restore it
  # so the prompt remains visible on stderr.
  local answer=n
  local tty_ok=1
  exec 4>&2 2>/dev/null
  exec 3<>/dev/tty && tty_ok=0 || tty_ok=$?
  exec 2>&4 4>&-
  if [[ "$tty_ok" -eq 0 ]]; then
    read -rp "$(user_text 'AKARI Video 本体がこのパソコンにまだ入っていません。いまセットアップしますか？（数分かかります） [Y/n] ' 'AKARI Video is not installed on this computer. Set it up now? (This takes a few minutes.) [Y/n] ')" answer <&3 || answer=n
    exec 3<&-
  fi

  if [[ ! "${answer:-Y}" =~ ^[Yy] ]]; then
    show_setup_guide
    exit 1
  fi

  info "$(user_text 'セットアップしています…（数分かかります）' 'Setting up AKARI Video… (This takes a few minutes.)')"
  export AKARI_SELF_HEAL_ATTEMPTED=1
  if ! run_self_heal_installer; then
    err "$(user_text 'セットアップに失敗しました。' 'Setup failed.')"
    show_setup_guide
    exit 1
  fi

  info "$(user_text 'セットアップが完了しました。続行します…' 'Setup is complete. Continuing…')"
  # macOS Bash 3.2 treats an empty `"${arr[@]}"` expansion under `set -u`
  # as an unbound variable (fixed in Bash 4.4).
  # Branch on the array length before expanding exec arguments.
  if [[ ${#ORIGINAL_ARGS[@]} -gt 0 ]]; then
    exec "$SCRIPT_PATH" "${ORIGINAL_ARGS[@]}"
  else
    exec "$SCRIPT_PATH"
  fi
}

MONOREPO="$(find_monorepo "$SCRIPT_PATH")" || self_heal_and_reexec

# ─── Resolve Node.js: system PATH first, then portable Node (install.sh's
#     ~/.akari/runtime/ fallback for machines without a system Node).
#     Assign `NODE_BIN` directly in the global scope; $(...) uses a subshell,
#     so exporting PATH inside it does not affect the parent shell. ───
resolve_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="node"
    return 0
  fi
  local runtime_dir="$HOME/.akari/runtime"
  local candidate
  candidate="$(find "$runtime_dir" -mindepth 1 -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$candidate" ]] && [[ -x "$candidate/bin/node" ]]; then
    # Add to PATH for later spawned children (npm and ffmpeg-static lookups).
    # Keep the portable runtime first.
    export PATH="$candidate/bin:$PATH"
    NODE_BIN="$candidate/bin/node"
    return 0
  fi
  return 1
}
# Use the same consent flow when Node is missing, then install the portable
# Node runtime and retry. On retry, resolve_node finds it through the
# runtime_dir scan above.
resolve_node || self_heal_and_reexec

# ─── Preview server launcher ───
cmd_preview() {
  local PROJECT="${AKARI_PROJECT:-.}"
  local PORT="${AKARI_PORT:-4567}"
  local OPEN_BROWSER=false
  local ARGS=("$@")

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help|-\?)
        echo "Usage: akari.sh --preview [options] [project-path] [port]"
        echo ""
        echo "Options:"
        echo "  -p, --port <port>    Port number (default: 4567; or set AKARI_PORT)"
        echo "  -o, --open           Open browser automatically"
        echo ""
        echo "Port can also be given as a bare number (the last positional arg)."
        echo "If the project dir has no edit.json, it is auto-created."
        echo ""
        echo "Examples:"
        echo "  akari.sh --preview                  # current dir, port 4567"
        echo "  akari.sh --preview 3000             # current dir, port 3000"
        echo "  akari.sh --preview ~/my-video 3000"
        return 0 ;;
      -p|--port) PORT="$2"; shift 2 ;;
      -o|--open) OPEN_BROWSER=true; shift ;;
      *)
        if [[ "$1" =~ ^[0-9]+$ ]]; then PORT="$1"
        elif [[ "$PROJECT" == "." ]] || [[ "$PROJECT" == "$AKARI_PROJECT" ]]; then PROJECT="$1"
        else err "Multiple project paths specified"; return 1; fi
        shift ;;
    esac
  done

  mkdir -p "$PROJECT" 2>/dev/null || true
  PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd)" || { err "Project directory not found: $PROJECT"; return 1; }

  if [[ ! -f "$PROJECT/edit.json" ]]; then
    info "Project not initialized. Scaffolding from template..."
    cp -r "$MONOREPO/templates/project-default/"* "$PROJECT/" 2>/dev/null || true
    cp "$MONOREPO/templates/project-default/.gitignore" "$PROJECT/" 2>/dev/null || true
    cp -r "$MONOREPO/templates/project-default/".* "$PROJECT/" 2>/dev/null || true
    touch "$PROJECT/assets/.gitkeep" "$PROJECT/exports/.gitkeep" "$PROJECT/planning/.gitkeep" 2>/dev/null || true
    mkdir -p "$PROJECT/.akari/cache" "$PROJECT/.akari/diffs" "$PROJECT/.akari/events" "$PROJECT/.akari/reports" "$PROJECT/.akari/sidecars" "$PROJECT/.akari/work" 2>/dev/null || true
    echo '{"version":1,"status":"draft"}' > "$PROJECT/.akari/intake.json" 2>/dev/null || true
    echo "{}" > "$PROJECT/edit.json" 2>/dev/null || true
    info "  Created: $PROJECT"
  fi

  info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  info "  AKARI Video Preview Server"
  info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo -e "  ${BOLD}Project:${NC} $PROJECT"
  echo -e "  ${BOLD}URL:${NC}     http://localhost:$PORT"
  echo ""
  echo -e "  ${MUTED}$(user_text 'Ctrl+C で停止' 'Press Ctrl+C to stop')${NC}"
  echo ""

  "$NODE_BIN" "$MONOREPO/packages/preview-server/src/server.mjs" "$PROJECT" --port "$PORT" &
  PID=$!
  trap "kill $PID 2>/dev/null; exit" INT TERM

  if [[ "$OPEN_BROWSER" == "true" ]]; then
    sleep 1
    case "$(uname -s)" in Darwin*) open "http://localhost:$PORT" ;; Linux*) xdg-open "http://localhost:$PORT" 2>/dev/null || true ;; esac
  fi
  wait $PID
}

# ─── Main ───
if [[ $# -eq 0 ]]; then
  # Default to Claude Code through the launcher's automatic detection.
  # Pass --opencode explicitly to use it instead.
  exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs"
fi

case "$1" in
  -h|--help|-\?)
    SCRIPT_NAME="$(basename "$0")"
    echo "AKARI Video — AI-powered video editor"
    echo ""
    echo "Usage: $SCRIPT_NAME [command] [options...]"
    echo ""
    echo "Commands:"
    echo "  (no args)             $(user_text 'Launch AI agent (Claude Code優先)' 'Launch AI agent (Claude Code preferred)')"
    echo "  --preview, -pv        Start preview server"
    echo "  store connect         Connect your account (free starter pack + purchased assets)"
    echo "  sounds                Download official sound library (AKARI Sounds, free)"
    echo "  update                Check for updates"
    echo "  --opencode            Use opencode instead of Claude Code"
    echo "  --claude, --claudecode  Launch Claude Code explicitly"
    echo "  -y, --yes             Auto-confirm (skip permissions; opencode:--auto / Claude:--permission-mode acceptEdits)"
    echo "  -h, --help, -?        Show this help"
    echo ""
    echo "Typical workflow:"
    echo "  1. mkdir ~/my-first-video && cd ~/my-first-video"
    echo "  2. $SCRIPT_NAME                        # AI agent (project auto-created)"
    echo "  3. $SCRIPT_NAME --preview               # $(user_text 'Preview server (別の端末で)' 'Preview server (in another terminal)')"
    echo "  4. $SCRIPT_NAME store connect           # $(user_text '無料の素材パックを使えるようにする' 'Enable the free asset pack')"
    echo "  5. $SCRIPT_NAME update                  # $(user_text '更新を確認する' 'Check for updates')"
    echo ""
    echo "Examples:"
    echo "  $SCRIPT_NAME                           # $(user_text 'Claude Code起動' 'Launch Claude Code')"
    echo "  $SCRIPT_NAME --preview                 # Preview (current dir)"
    echo "  $SCRIPT_NAME --preview ~/my-project 3000"
    echo "  $SCRIPT_NAME store connect             # $(user_text '無料の素材パックを使えるようにする' 'Enable the free asset pack')"
    echo "  $SCRIPT_NAME update"
    echo "  $SCRIPT_NAME -y                        # Claude Code + auto-confirm"
    echo "  $SCRIPT_NAME --opencode -y             # opencode + auto-confirm"
    exit 0 ;;
  --preview|-pv) shift; cmd_preview "$@" ;;
  update) exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "update" ;;
  sounds) shift; exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "sounds" "$@" ;;
  --opencode) shift; exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--opencode" "$@" ;;
  --claude|--claudecode) shift; exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--claude" "$@" ;;
  -y|--yes) shift; exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--yes" "$@" ;;
  *) exec "$NODE_BIN" "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "$@" ;;
esac
