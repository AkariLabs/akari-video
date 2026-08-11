#!/usr/bin/env bash
# AKARI Video — メインエントリーポイント
set -euo pipefail

MUTED='\033[0;2m'; RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[38;5;214m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
err()  { echo -e "${RED}$1${NC}"; }

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
  # install.sh 済みの環境（プロジェクトフォルダを新 PC へ持ち込んだ場合も含む）を拾う。
  local install_dir="${AKARI_INSTALL_DIR:-$HOME/.akari/app}"
  if [[ -f "$install_dir/packages/akari-launcher/bin/akari.mjs" ]]; then
    echo "$install_dir"; return 0
  fi
  return 1
}

# ─── 行き止まり撤去: 本体/Node が見つからない・使えないときに、専門語
#     （Node / monorepo / PATH / env）を出さず 1 問の同意でその場セットアップ
#     して復帰する。承諾されればインストーラ実行後に元のコマンドをそのまま
#     再実行し、拒否・非対話（tty 無し: CI・パイプ）なら案内 1 行だけ出して
#     exit 1 する（install.sh の /dev/tty ガードと同じ流儀） ───
INSTALL_ONE_LINER='curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash'

show_setup_guide() {
  warn "セットアップするには次を実行してください: $INSTALL_ONE_LINER"
}

run_self_heal_installer() {
  if [[ -n "${AKARI_SELF_HEAL_INSTALLER:-}" ]]; then
    # テスト・開発用フック: 実ネットワークを叩かず、指定コマンドで代替する。
    bash -c "$AKARI_SELF_HEAL_INSTALLER"
  else
    curl -fsSL "https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh" | bash
  fi
}

self_heal_and_reexec() {
  if [[ -n "${AKARI_SELF_HEAL_ATTEMPTED:-}" ]]; then
    err "セットアップを試みましたが、まだ利用できる状態になっていません。お手数ですが上記コマンドを手動で実行するか、サポートにご相談ください。"
    show_setup_guide
    exit 1
  fi

  # 制御端末が実際に開けるかをまず確認する（パーミッションビットは常に rw に
  # 見えるため事前チェックでは判定できない — install.sh の /dev/tty ガードと
  # 同じ流儀）。注意: 素の `exec 3<>/dev/tty 2>/dev/null`（コマンド無しの
  # exec）は、その 2>/dev/null をこの後ずっとシェルへ居座らせてしまう
  # （サブシェルではなく現在のシェルの fd テーブルを直接書き換えるため）。
  # それだと `read -p` のプロンプト（fd2 に出る仕様）まで道連れで消え、実機で
  # 無言のまま止まって見える不具合になる。open 試行時だけ fd2 を一時退避して
  # 復元することで、プロンプト自体は素の stderr へ出す。
  local answer=n
  local tty_ok=1
  exec 4>&2 2>/dev/null
  exec 3<>/dev/tty && tty_ok=0 || tty_ok=$?
  exec 2>&4 4>&-
  if [[ "$tty_ok" -eq 0 ]]; then
    read -rp "AKARI Video 本体がこのパソコンにまだ入っていません。いまセットアップしますか？（数分かかります） [Y/n] " answer <&3 || answer=n
    exec 3<&-
  fi

  if [[ ! "${answer:-Y}" =~ ^[Yy] ]]; then
    show_setup_guide
    exit 1
  fi

  info "セットアップしています…（数分かかります）"
  export AKARI_SELF_HEAL_ATTEMPTED=1
  if ! run_self_heal_installer; then
    err "セットアップに失敗しました。"
    show_setup_guide
    exit 1
  fi

  info "セットアップが完了しました。続行します…"
  # macOS 標準の bash（3.2 系）は `set -u` 下で空配列の `"${arr[@]}"` 展開を
  # unbound variable として落とす（bash 4.4 で修正された既知の非互換）。
  # 配列が空かどうかで exec の引数展開自体を分岐して回避する。
  if [[ ${#ORIGINAL_ARGS[@]} -gt 0 ]]; then
    exec "$SCRIPT_PATH" "${ORIGINAL_ARGS[@]}"
  else
    exec "$SCRIPT_PATH"
  fi
}

MONOREPO="$(find_monorepo "$SCRIPT_PATH")" || self_heal_and_reexec

# ─── Resolve Node.js: system PATH first, then portable Node (install.sh's
#     ~/.akari/runtime/ fallback for machines without a system Node).
#     `NODE_BIN` はグローバル変数に直接代入する — $(...) はサブシェルなので
#     中の export PATH が親シェルへ伝わらない ───
resolve_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="node"
    return 0
  fi
  local runtime_dir="$HOME/.akari/runtime"
  local candidate
  candidate="$(find "$runtime_dir" -mindepth 1 -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$candidate" ]] && [[ -x "$candidate/bin/node" ]]; then
    # このプロセス以降で spawn される子（npm・ffmpeg-static 探索など）にも
    # 効くよう PATH の先頭に足す。
    export PATH="$candidate/bin:$PATH"
    NODE_BIN="$candidate/bin/node"
    return 0
  fi
  return 1
}
# Node 不在も行き止まりにしない: 3 と同じ同意フローでインストーラを実行し
# （portable Node を入れて）復帰する（再実行時は resolve_node が上の
# runtime_dir 走査で拾う）。
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
  echo -e "  ${MUTED}Ctrl+C で停止${NC}"
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
  # デフォルトは Claude Code（launcher の自動検出に任せる）
  # --opencode を付けたい場合は明示的に指定
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
    echo "  (no args)             Launch AI agent (Claude Code優先)"
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
    echo "  3. $SCRIPT_NAME --preview               # Preview server (別の端末で)"
    echo "  4. $SCRIPT_NAME store connect           # 無料の素材パックを使えるようにする"
    echo "  5. $SCRIPT_NAME update                  # 更新を確認する"
    echo ""
    echo "Examples:"
    echo "  $SCRIPT_NAME                           # Claude Code起動"
    echo "  $SCRIPT_NAME --preview                 # Preview (current dir)"
    echo "  $SCRIPT_NAME --preview ~/my-project 3000"
    echo "  $SCRIPT_NAME store connect             # 無料の素材パックを使えるようにする"
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
