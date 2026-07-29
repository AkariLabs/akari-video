#!/usr/bin/env bash
# AKARI Video Preview Server — 起動スクリプト
set -euo pipefail

MUTED='\033[0;2m'; RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[38;5;214m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

PROJECT="${AKARI_PROJECT:-.}"
PORT="${AKARI_PORT:-4567}"
OPEN_BROWSER=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      echo "AKARI Video Preview Server"
      echo ""
      echo "Usage: preview.sh [options] [project-path] [port]"
      echo ""
      echo "Options:"
      echo "  -p, --port <port>    Port number (default: 4567, env: AKARI_PORT)"
      echo "  -o, --open           Open browser automatically"
      echo "  -h, --help           Show this help"
      echo ""
      echo "Port can also be given as a bare number (the last positional arg)."
      echo ""
      echo "Examples:"
      echo "  ./preview.sh                          # current dir, port 4567"
      echo "  ./preview.sh 3000                     # current dir, port 3000"
      echo "  ./preview.sh ./test-project 3000      # project + port"
      echo "  ./preview.sh ./test-project -o        # open browser"
      exit 0 ;;
    -p|--port) PORT="$2"; shift 2 ;;
    -o|--open) OPEN_BROWSER=true; shift ;;
    -*)
      warn "Unknown option: $1"; shift ;;
    *)
      # Bare number → port; anything else → project path
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        PORT="$1"
      elif [[ "$PROJECT" == "." ]] || [[ "$PROJECT" == "$AKARI_PROJECT" ]]; then
        PROJECT="$1"
      else
        err "Multiple project paths specified"; exit 1
      fi
      shift ;;
  esac
done

# Confirm project has edit.json
if [[ ! -f "$PROJECT/edit.json" ]]; then
  err "Not an AKARI Video project: $PROJECT/edit.json not found"
  echo ""
  echo "  Create a project first with:"
  echo "    node packages/create-project/bin/create-project.mjs <path>"
  echo ""
  echo "  Or point to an existing project:"
  echo "    ./preview.sh /path/to/akari-video-project"
  echo ""
  exit 1
fi

# Resolve project to absolute path
PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd)" || { err "Project directory not found: $PROJECT"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "  AKARI Video Preview Server"
info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  ${BOLD}Project:${NC} $PROJECT"
echo -e "  ${BOLD}URL:${NC}     http://localhost:$PORT"
echo ""
echo -e "  ${MUTED}Ctrl+C で停止${NC}"
echo ""

node "$SCRIPT_DIR/packages/preview-server/src/server.mjs" "$PROJECT" --port "$PORT" &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM

if [[ "$OPEN_BROWSER" == "true" ]]; then
  sleep 1
  case "$(uname -s)" in
    Darwin*) open "http://localhost:$PORT" ;;
    Linux*)  xdg-open "http://localhost:$PORT" 2>/dev/null || true ;;
  esac
fi

wait $SERVER_PID
