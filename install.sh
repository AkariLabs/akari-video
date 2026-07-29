#!/usr/bin/env bash
set -euo pipefail

# ─── AKARI Video Installer (Windows / Linux / macOS) ───
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.sh | bash

MUTED='\033[0;2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[38;5;214m'
BOLD='\033[1m'
NC='\033[0m'

REPO="kuwa2005/akari-video"
INSTALL_DIR="${AKARI_INSTALL_DIR:-$HOME/akari-video}"
SKIP_DEPS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            echo "AKARI Video Installer"
            echo ""
            echo "Usage: install.sh [options]"
            echo ""
            echo "Options:"
            echo "  -d, --dir <path>    Install directory (default: ~/akari-video)"
            echo "      --skip-deps     Skip dependency checks"
            echo "  -h, --help          Show this help"
            echo ""
            echo "Examples:"
            echo "  curl -fsSL https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.sh | bash"
            echo "  curl -fsSL ... | bash -s -- -d ~/my-project"
            exit 0 ;;
        -d|--dir)    INSTALL_DIR="$2"; shift 2 ;;
        --skip-deps) SKIP_DEPS=true; shift ;;
        *) echo -e "${YELLOW}Unknown option: $1${NC}" >&2; shift ;;
    esac
done

info()  { echo -e "${GREEN}$1${NC}"; }
warn()  { echo -e "${YELLOW}$1${NC}"; }
err()   { echo -e "${RED}$1${NC}"; }
has()   { command -v "$1" >/dev/null 2>&1; }

os() {
    case "$(uname -s)" in
        Darwin*) echo "macos" ;;
        Linux*)  echo "linux" ;;
        *)       echo "unknown" ;;
    esac
}

echo ""
echo -e "${MUTED}    _             _ _             _   _     _  ${NC}"
echo -e "${MUTED}   / \\   _ __  __| | |_ __ __ _  | | | |___| |_${NC}"
echo -e "${MUTED}  / _ \\ | '__|/ _\` | | '__/ _\` | | | | / _ \ __|${NC}"
echo -e "${MUTED} / ___ \\| |  | (_| | | | | (_| | | |_| |  __/ |_ ${NC}"
echo -e "${MUTED}/_/   \\_\\_|   \\__,_|_|_|  \\__,_|  \\___/ \\___|\\__|${NC}"
echo ""
echo -e "${MUTED}AI-powered video editor — installer${NC}"
echo ""

# ═══════════════════════════════════════════════
#  1. Node.js + npm
# ═══════════════════════════════════════════════

check_node() {
    if has node; then
        local major
        major=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
        if [[ "$major" -ge 20 ]]; then
            info "  [OK] Node.js $(node --version)"
            info "  [OK] npm     $(npm --version 2>/dev/null || echo '?')"
            return 0
        else
            warn "  [!!] Node.js $(node --version) — v20+ required"
            return 1
        fi
    fi
    err "  [--] Node.js not found"
    return 1
}

install_node() {
    local target_os
    target_os=$(os)
    echo ""
    info "Installing Node.js (v20 LTS)..."
    case "$target_os" in
        macos)
            if has brew; then brew install node@20 && brew link --overwrite node@20
            else warn "Install Homebrew first: https://brew.sh"; return 1; fi ;;
        linux)
            if has apt-get; then
                curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                sudo apt-get install -y nodejs
            elif has dnf; then
                curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
                sudo dnf install -y nodejs
            elif has pacman; then sudo pacman -S --noconfirm nodejs npm
            elif has apk; then sudo apk add --no-cache nodejs npm
            elif has zypper; then sudo zypper install --non-interactive nodejs20 npm
            else warn "Install Node.js manually: https://nodejs.org/"; return 1; fi ;;
    esac
    if has node; then info "  Node.js $(node --version) installed"; else err "Install failed: https://nodejs.org/"; return 1; fi
}

# ═══════════════════════════════════════════════
#  2. AI Agent — opencode (primary) / Claude Code (secondary)
# ═══════════════════════════════════════════════

check_agent() {
    local found=false
    if has opencode; then
        info "  [OK] opencode (primary)"
        found=true
    fi
    if has claude; then
        info "  [OK] Claude Code (secondary)"
        found=true
    fi
    if [[ "$found" == "false" ]]; then
        err "  [--] No AI agent found"
    fi
    return $( [[ "$found" == "false" ]] )
}

install_opencode() {
    echo ""
    info "Installing opencode..."
    curl -fsSL https://opencode.ai/install | bash
}

# ═══════════════════════════════════════════════
#  3. ffmpeg
# ═══════════════════════════════════════════════

check_ffmpeg() {
    if has ffmpeg; then
        info "  [OK] ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
        return 0
    fi
    warn "  [--] ffmpeg not found (optional, recommended)"
    return 1
}

install_ffmpeg() {
    local target_os
    target_os=$(os)
    echo ""
    info "Installing ffmpeg..."
    case "$target_os" in
        macos) has brew && brew install ffmpeg || { warn "Install Homebrew: https://brew.sh"; return 1; } ;;
        linux)
            if has apt-get; then sudo apt-get update && sudo apt-get install -y ffmpeg
            elif has dnf; then sudo dnf install -y ffmpeg
            elif has pacman; then sudo pacman -S --noconfirm ffmpeg
            elif has apk; then sudo apk add --no-cache ffmpeg
            elif has zypper; then sudo zypper install --non-interactive ffmpeg
            else warn "Install ffmpeg manually: https://ffmpeg.org/download.html"; return 1; fi ;;
    esac
}

# ═══════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════

echo "Checking dependencies..."
echo ""

node_ok=false; check_node && node_ok=true
agent_ok=false; check_agent && agent_ok=true
ffmpeg_ok=false; check_ffmpeg && ffmpeg_ok=true

if [[ "$SKIP_DEPS" == "false" ]]; then
    if [[ "$node_ok" == "false" ]]; then install_node || true; has node && node_ok=true; fi

    if [[ "$agent_ok" == "false" ]]; then
        echo ""
        warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        warn "  AI agent is required."
        warn ""
        warn "  opencode (free, recommended)"
        warn "  Claude Code (paid) — https://claude.ai/install.sh"
        warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        read -rp "Install opencode now? [Y/n] " answer
        if [[ "${answer:-Y}" =~ ^[Yy] ]]; then
            install_opencode || true
        else
            echo ""
            warn "  Install manually:"
            warn "    curl -fsSL https://opencode.ai/install | bash"
            echo ""
        fi
        check_agent && agent_ok=true
    fi

    if [[ "$ffmpeg_ok" == "false" ]] && [[ "$node_ok" == "true" ]]; then
        read -rp "Install ffmpeg now? [Y/n] " answer
        [[ "${answer:-Y}" =~ ^[Yy] ]] && install_ffmpeg || true
    fi
fi

# Clone or update
echo ""
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Repository exists at $INSTALL_DIR"
    info "Pulling latest..."
    git -C "$INSTALL_DIR" fetch origin 2>&1 | grep -v "^remote:" || true
    if git -C "$INSTALL_DIR" merge --ff-only origin/main 2>&1; then
        info "  Updated to $(git -C "$INSTALL_DIR" log --oneline -1)"
    else
        warn "  Fast-forward failed — resetting to origin/main..."
        git -C "$INSTALL_DIR" reset --hard origin/main
    fi
elif [[ -d "$INSTALL_DIR" ]]; then
    warn "Directory exists but is not a git repo: $INSTALL_DIR — skipping clone."
else
    info "Cloning $REPO..."
    git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
fi

echo ""
info "Installing npm dependencies..."
(cd "$INSTALL_DIR" && npm install --no-audit --no-fund --loglevel=error 2>&1 | grep -v "^npm warn" || true)

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "  ${BOLD}Installed to:${NC} $INSTALL_DIR"
echo ""

# ─── PATH 登録 ───
SHELL_CONFIG=""
case "$(basename "${SHELL:-bash}")" in
  zsh) SHELL_CONFIG="$HOME/.zshrc" ;;
  bash) SHELL_CONFIG="$HOME/.bashrc" ;;
esac

if [[ -n "$SHELL_CONFIG" ]] && ! grep -q "$INSTALL_DIR" "$SHELL_CONFIG" 2>/dev/null; then
  echo "" >> "$SHELL_CONFIG"
  echo "# AKARI Video" >> "$SHELL_CONFIG"
  echo "export PATH=\"\$PATH:$INSTALL_DIR\"" >> "$SHELL_CONFIG"
  # 現在のセッションにも反映
  export PATH="$PATH:$INSTALL_DIR"
  info "  PATH を通しました: $SHELL_CONFIG"
  info "  → akari.sh がすぐに使えます"
elif [[ -z "$SHELL_CONFIG" ]]; then
  warn "  PATH の自動登録に対応していないシェルです。手動で以下を PATH に追加してください:"
  warn "    $INSTALL_DIR"
fi

echo ""
echo -e "  ${BOLD}Quick start:${NC}"
echo ""
echo -e "    0. ヘルプを表示（サブコマンド一覧）"
echo -e "       ${MUTED}akari.sh --help${NC}"
echo ""
echo -e "    1. 作業用ディレクトリを作って移動"
echo -e "       ${MUTED}mkdir ~/my-first-video && cd ~/my-first-video${NC}"
echo ""
echo -e "    2. AI エージェントを起動（プロジェクトが自動生成される）"
echo -e "       ${MUTED}akari.sh${NC}"
echo ""
echo -e "    3. 別の端末でプレビューサーバーを起動"
echo -e "       ${MUTED}akari.sh --preview${NC}"
echo ""
echo -e "${MUTED}Docs: https://github.com/$REPO/blob/main/docs/getting-started.ja.md${NC}"
echo ""
