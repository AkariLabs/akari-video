#!/usr/bin/env bash
# AKARI Video — メインエントリーポイント
set -euo pipefail

MUTED='\033[0;2m'; RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[38;5;214m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

# ─── Resolve script location (works via PATH/symlink) ───
SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"

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
  return 1
}
MONOREPO="$(find_monorepo "$SCRIPT_PATH")" || { err "Cannot find AKARI Video monorepo. Set AKARI_MONOREPO or run from within the repo."; exit 1; }

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
        echo "  -p, --port <port>    Port number (default: 4567, env: AKARI_PORT)"
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
    echo '{"version":1,"status":"draft"}' > "$PROJECT/intake.json" 2>/dev/null || true
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
  echo -e "  ${MUTED}Ctrl+C で停止${NC}"
  echo ""

  node "$MONOREPO/packages/preview-server/src/server.mjs" "$PROJECT" --port "$PORT" &
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
  # デフォルトは Claude Code（launcher の自動検出に任せる）
  # --opencode を付けたい場合は明示的に指定
  exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs"
fi

case "$1" in
  -h|--help|-\?)
    SCRIPT_NAME="$(basename "$0")"
    echo "AKARI Video — AI-powered video editor"
    echo ""
    echo "Usage: $SCRIPT_NAME [command] [options...]"
    echo ""
    echo "Commands:"
    echo "  (no args)             Launch AI agent (Claude Code優先)"
    echo "  --preview, -pv        Start preview server"
    echo "  update                Check for updates"
    echo "  --opencode            Use opencode instead of Claude Code"
    echo "  --claude, --claudecode  Launch Claude Code explicitly"
    echo "  -y, --yes             Auto-confirm (skip permissions; opencode:--auto / Claude:-y)"
    echo "  -h, --help, -?        Show this help"
    echo ""
    echo "Typical workflow:"
    echo "  1. mkdir ~/my-first-video && cd ~/my-first-video"
    echo "  2. $SCRIPT_NAME                        # AI agent (project auto-created)"
    echo "  3. $SCRIPT_NAME --preview               # Preview server (別の端末で)"
    echo ""
    echo "Examples:"
    echo "  $SCRIPT_NAME                           # Claude Code起動"
    echo "  $SCRIPT_NAME -y                        # Claude Code + auto-confirm"
    echo "  $SCRIPT_NAME --opencode -y             # opencode + auto-confirm"
    echo "  $SCRIPT_NAME --preview                 # Preview (current dir)"
    echo "  $SCRIPT_NAME --preview ~/my-project 3000"
    echo "  $SCRIPT_NAME update"
    exit 0 ;;
  --preview|-pv) shift; cmd_preview "$@" ;;
  update) exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "update" ;;
  --opencode) exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--opencode" ;;
  --claude|--claudecode) exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--claude" ;;
  -y|--yes) exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "--yes" ;;
  *) exec node "$MONOREPO/packages/akari-launcher/bin/akari.mjs" "$@" ;;
esac
