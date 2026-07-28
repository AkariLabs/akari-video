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
            echo "  -d, --dir <path>    Install directory (default: ~/akari-video)"
            echo "      --skip-deps     Skip dependency checks"
            echo "  -h, --help          Show this help"
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
        warn "  AI agent is required. Install one of:"
        warn ""
        warn "  opencode (free, recommended):"
        warn "    curl -fsSL https://opencode.ai/install | bash"
        warn ""
        warn "  Claude Code (paid):"
        warn "    curl -fsSL https://claude.ai/install.sh | bash"
        warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
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
    git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || warn "Could not pull. Using existing version."
elif [[ -d "$INSTALL_DIR" ]]; then
    warn "Directory exists but is not a git repo: $INSTALL_DIR — skipping clone."
else
    info "Cloning $REPO..."
    git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
fi

echo ""
info "Installing npm dependencies..."
(cd "$INSTALL_DIR" && npm install --ignore-scripts --no-audit --no-fund)

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if has opencode; then
    echo -e "  ${BOLD}Quick start (opencode):${NC}"
    echo ""
    echo -e "    cd $INSTALL_DIR"
    echo -e "    node packages/akari-launcher/bin/akari.mjs --opencode"
    echo ""
fi

if has claude; then
    echo -e "  ${BOLD}Quick start (Claude Code):${NC}"
    echo ""
    echo -e "    cd $INSTALL_DIR"
    echo -e "    node packages/akari-launcher/bin/akari.mjs"
    echo ""
fi

if ! has opencode && ! has claude; then
    echo -e "  ${YELLOW}AI agent not yet installed.${NC}"
    echo ""
    echo -e "  After installing opencode (or Claude Code), run:"
    echo ""
    echo -e "    cd $INSTALL_DIR"
    echo -e "    node packages/akari-launcher/bin/akari.mjs"
    echo ""
fi

echo -e "${MUTED}Docs: https://github.com/$REPO/blob/main/docs/getting-started.ja.md${NC}"
echo ""
