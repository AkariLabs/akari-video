#!/usr/bin/env bash
set -euo pipefail

# ─── AKARI Video Installer (Windows / Linux / macOS) ───
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash
#
# brew / git / sudo は一切要求しない（さらのマシンでも 1 行で完結させるため）。
# Node.js は見つからなければ nodejs.org の公式 tarball を、入れ替え対象の
# アプリ本体とは別のユーザー領域（~/.akari/runtime/）へ展開する。
# リポジトリ取得は git ではなく GitHub の tarball（codeload.github.com）を使う。

MUTED='\033[0;2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[38;5;214m'
BOLD='\033[1m'
NC='\033[0m'

REPO="AkariLabs/akari-video"
INSTALL_DIR="${AKARI_INSTALL_DIR:-$HOME/.akari/app}"
SKIP_DEPS=false
# require(esm) は Node 20.19.0 で有効化された（それ未満だと @theia/cli 等の
# require('puppeteer-core') が ERR_REQUIRE_ESM で落ちる）。20.x 系のまま
# 最新パッチへ留めるのは、Electron 側のネイティブモジュール ABI（メジャー
# バージョン依存）を変えずに直すため。バージョン文字列はダウンロード先
# ディレクトリ名にも埋め込まれる（install_portable_node 参照）ので、
# ここを上げるだけで旧版導入済み環境でも自動的に新版が再ダウンロードされる。
PORTABLE_NODE_VERSION="20.20.2"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            echo "AKARI Video Installer"
            echo ""
            echo "Usage: install.sh [options]"
            echo ""
            echo "Options:"
            echo "  -d, --dir <path>    Install directory (default: ~/.akari/app)"
            echo "      --skip-deps     Skip dependency checks"
            echo "  -h, --help          Show this help"
            echo ""
            echo "Examples:"
            echo "  curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash"
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

OLD_INSTALL_DIR="$HOME/akari-video"
if [[ -f "$OLD_INSTALL_DIR/.akari-install-ref" ]] \
    && [[ "${INSTALL_DIR%/}" != "$OLD_INSTALL_DIR" ]]; then
    warn "  [!!] Found an older AKARI Video installation at $OLD_INSTALL_DIR."
    warn "       The new installation will use $INSTALL_DIR."
    warn "       Both installations can coexist; this installer will not modify or remove the old one."
    warn "       After confirming the new installation works, you may remove the old one manually:"
    warn "         rm -rf \"$OLD_INSTALL_DIR\""
    warn "       Also open ~/.zshrc or ~/.bashrc and remove the old PATH block:"
    warn "         # AKARI Video"
    warn "         export PATH=\"\$PATH:$OLD_INSTALL_DIR\""
    warn "       Remove only the block whose export PATH line refers to $OLD_INSTALL_DIR."
    echo ""
fi

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

# sudo にパスワードなしでアクセスできるか（-n はプロンプトを一切出さず即座に
# 成否だけ返す）。ダイアログ・プロンプトを一切出さないための必須ガード。
have_passwordless_sudo() {
    has sudo && sudo -n true >/dev/null 2>&1
}

# nodejs.org の公式 tarball を ~/.akari/runtime/ へ展開する。admin 権限不要・
# sudo 不使用。以後このプロセス内では PATH の先頭に置いて node/npm を使う。
install_portable_node() {
    local target_os arch node_platform node_arch node_name dest_dir url tmp_dir tmp_tar
    target_os=$(os)
    arch="$(uname -m)"

    case "$target_os" in
        macos) node_platform="darwin" ;;
        linux) node_platform="linux" ;;
        *) err "  Portable Node.js is not available for this OS: $target_os"; return 1 ;;
    esac
    case "$arch" in
        x86_64|amd64)  node_arch="x64" ;;
        arm64|aarch64) node_arch="arm64" ;;
        *) err "  Portable Node.js is not available for this architecture: $arch"; return 1 ;;
    esac

    node_name="node-v${PORTABLE_NODE_VERSION}-${node_platform}-${node_arch}"
    dest_dir="$HOME/.akari/runtime/${node_name}"

    if [[ -x "$dest_dir/bin/node" ]]; then
        info "  [OK] Portable Node.js already installed: $dest_dir"
    else
        echo ""
        info "Downloading portable Node.js v${PORTABLE_NODE_VERSION} (${node_platform}-${node_arch})..."
        info "  → $HOME/.akari/runtime/ (no admin password needed)"
        mkdir -p "$HOME/.akari/runtime"
        url="https://nodejs.org/dist/v${PORTABLE_NODE_VERSION}/${node_name}.tar.gz"
        tmp_dir="$(mktemp -d)"
        tmp_tar="$tmp_dir/node.tar.gz"
        if ! curl -fsSL "$url" -o "$tmp_tar"; then
            err "  Failed to download portable Node.js from $url"
            rm -rf "$tmp_dir"
            return 1
        fi
        tar -xzf "$tmp_tar" -C "$HOME/.akari/runtime"
        rm -rf "$tmp_dir"
    fi

    export PATH="$dest_dir/bin:$PATH"
    if has node; then
        info "  Node.js $(node --version) ready (portable — $dest_dir)"
        return 0
    fi
    err "  Portable Node.js install did not produce a working binary"
    return 1
}

install_node() {
    local target_os
    target_os=$(os)

    # sudo がパスワードなしで使える Linux だけ、システムパッケージマネージャ
    # 経由の高速路を試す。それ以外（macOS 全般・sudo 不可の Linux）は最初から
    # ポータブル Node へ進む — brew / パスワード付き sudo は一切呼ばない。
    if [[ "$target_os" == "linux" ]] && have_passwordless_sudo; then
        echo ""
        info "Installing Node.js (v20 LTS) via system package manager..."
        if has apt-get; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif has dnf; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo dnf install -y nodejs
        elif has pacman; then sudo pacman -S --noconfirm nodejs npm
        elif has apk; then sudo apk add --no-cache nodejs npm
        elif has zypper; then sudo zypper install --non-interactive nodejs20 npm
        fi
        if has node; then
            info "  Node.js $(node --version) installed"
            return 0
        fi
        warn "  System package manager install did not produce a usable Node.js — falling back to portable Node.js"
    fi

    install_portable_node
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
        return 1
    fi
    return 0
}

install_opencode() {
    echo ""
    info "Installing opencode..."
    curl -fsSL https://opencode.ai/install | bash
}

# ═══════════════════════════════════════════════
#  3. ffmpeg — 検出のみ。packages/media-bin の postinstall が GPL-only ビルドを
#     pinned URL + sha256 検証で取得するため、ここでの brew/apt 経由インストールは不要。
# ═══════════════════════════════════════════════

check_ffmpeg() {
    if has ffmpeg; then
        info "  [OK] ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}') (PATH)"
        return 0
    fi
    warn "  [--] ffmpeg not found on PATH — no action needed: 'npm install' below pulls in a bundled GPL build automatically (sha256-verified)"
    return 1
}

# ═══════════════════════════════════════════════
#  4. Repository fetch — git ではなく GitHub tarball（codeload）を使う。
#     さらの Mac で git を叩くと Xcode CLT ダイアログが出るため。
# ═══════════════════════════════════════════════

# AKARI_REF が明示されていればそれを使う。無ければ最新の vX.Y.Z タグ、
# それも無ければ main ブランチへ落とす（従来の git 版と同じ優先順位）。
resolve_target_ref() {
    if [[ -n "${AKARI_REF:-}" ]]; then
        echo "$AKARI_REF"
        return 0
    fi
    local tags
    tags="$(curl -fsSL "https://api.github.com/repos/$REPO/tags?per_page=100" 2>/dev/null \
        | grep -o '"name": *"v[0-9][^"]*"' | sed -E 's/.*"(v[^"]+)"/\1/' || true)"
    if [[ -n "$tags" ]]; then
        printf '%s\n' "$tags" | sort -V | tail -1
        return 0
    fi
    echo "main"
}

# $ref のソースツリーを $dest へ展開する（$dest は展開前に空でなくてもよい —
# 既存ファイルは tarball の内容で上書きされる）。
fetch_release_tarball() {
    local ref="$1" dest="$2" url tmp_dir tmp_tar
    case "$ref" in
        main|master) url="https://codeload.github.com/$REPO/tar.gz/refs/heads/$ref" ;;
        *)           url="https://codeload.github.com/$REPO/tar.gz/refs/tags/$ref" ;;
    esac
    mkdir -p "$dest"
    tmp_dir="$(mktemp -d)"
    tmp_tar="$tmp_dir/archive.tar.gz"
    if ! curl -fsSL "$url" -o "$tmp_tar"; then
        rm -rf "$tmp_dir"
        return 1
    fi
    tar -xzf "$tmp_tar" -C "$dest" --strip-components=1
    rm -rf "$tmp_dir"
}

# 既存インストールの更新: node_modules は再利用（この後の npm install が整合
# させる）、それ以外は取得した新しい内容で丸ごと置き換える（git checkout
# --force 相当）。
update_install() {
    local ref="$1"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    if ! fetch_release_tarball "$ref" "$tmp_dir"; then
        rm -rf "$tmp_dir"
        return 1
    fi
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
    cp -a "$tmp_dir"/. "$INSTALL_DIR"/
    rm -rf "$tmp_dir"
    echo "$ref" > "$INSTALL_DIR/.akari-install-ref"
}

# ═══════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════

echo "Checking dependencies..."
echo ""

node_ok=false; check_node && node_ok=true
agent_ok=false; check_agent && agent_ok=true
check_ffmpeg || true

if [[ "$SKIP_DEPS" == "false" ]]; then
    if [[ "$node_ok" == "false" ]]; then
        install_node || true
        has node && node_ok=true
        if [[ "$node_ok" == "false" ]]; then
            echo ""
            err "  Node.js の準備に失敗しました。npm install 以降を続行できません。"
            err "  手動で Node.js v20.19 以上（または v22 LTS）を導入してから、再度このインストーラを実行してください。"
            exit 1
        fi
    fi

    if [[ "$agent_ok" == "false" ]]; then
        echo ""
        warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        warn "  AI agent is required."
        warn ""
        warn "  opencode (free, recommended)"
        warn "  Claude Code (paid) — https://claude.ai/install.sh"
        warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        # /dev/tty はパーミッションビット上は rw に見えても、制御端末を持たない
        # プロセス（コンテナ・CI・パイプ実行）では open(2) 自体が ENXIO で失敗する。
        # -r/-w の事前チェックでは検出できないため、read を直接試みて失敗を拾う。
        if ! read -rp "Install opencode now? [Y/n] " answer 2>/dev/null </dev/tty; then
            answer=n
        fi
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
fi

# Clone or update — 配布はリリースタグ固定（既定で main を配らない）
# main には検収前の変更が入り得るため、版整合ゲートを通過した最新のリリースタグ
# （vX.Y.Z）へ展開する。開発者が main や特定 ref を追いたい場合は
# AKARI_REF=main のように環境変数で上書きできる。git は使わない — GitHub の
# tarball（codeload.github.com）を curl + tar で展開する。
echo ""
if [[ -f "$INSTALL_DIR/.akari-install-ref" ]]; then
    info "Repository exists at $INSTALL_DIR"
    info "Fetching updates..."
    TARGET_REF="$(resolve_target_ref)"
    if update_install "$TARGET_REF"; then
        info "  Updated to: $TARGET_REF"
    else
        err "Failed to fetch update ($TARGET_REF)"
        exit 1
    fi
elif [[ -d "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    warn "Directory exists but was not created by this installer: $INSTALL_DIR — skipping download."
else
    TARGET_REF="$(resolve_target_ref)"
    info "Downloading $REPO ($TARGET_REF)..."
    if fetch_release_tarball "$TARGET_REF" "$INSTALL_DIR"; then
        echo "$TARGET_REF" > "$INSTALL_DIR/.akari-install-ref"
        info "  Downloaded: $TARGET_REF"
    else
        err "Failed to download $REPO ($TARGET_REF)"
        exit 1
    fi
fi

echo ""
info "Installing npm dependencies..."
# 新規・更新とも、展開先だけを CLI 用に絞る（ブラウザプレビューを含む）。
# AKARI_INSTALL_SHELL=1 の場合だけ、配布元の workspaces をそのまま使う。
if [[ "${AKARI_INSTALL_SHELL:-}" != "1" ]]; then
    (cd "${INSTALL_DIR}" && node -e "const fs = require('fs'); const p = 'package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.workspaces = ['packages/*']; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');")
fi
NPM_INSTALL_LOG="$(mktemp "${TMPDIR:-/tmp}/akari-npm-install.XXXXXX")"
# pipefail 下で npm install の非ゼロ終了を握りつぶさず拾うため、パイプ全体は
# 一時的に -e を外して実行し、PIPESTATUS[0]（npm 自身の終了コード。tee/grep の
# 終了コードではない）を直接読む。tee でログへも残しつつ画面には引き続き
# リアルタイムでストリーミングする（npm warn 行だけ間引く）。
set +e
(cd "$INSTALL_DIR" && npm install --no-audit --no-fund --loglevel=error) 2>&1 \
    | tee "$NPM_INSTALL_LOG" | grep -v "^npm warn"
npm_install_exit="${PIPESTATUS[0]}"
set -e

if [[ "$npm_install_exit" -ne 0 ]]; then
    echo ""
    err "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    err "  インストールに失敗しました（npm install が exit ${npm_install_exit} で終了）"
    err "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    warn "  失敗ログの末尾（全文: ${NPM_INSTALL_LOG}）:"
    echo ""
    tail -n 40 "$NPM_INSTALL_LOG" | sed 's/^/    /' >&2
    echo ""
    if grep -qiE 'gyp ERR|node-gyp|xcode-select|xcrun|CommandLineTools|Python was not found|No Xcode or CLT version detected' "$NPM_INSTALL_LOG"; then
        warn "  ネイティブモジュールのビルド（node-gyp）に失敗しているようです。"
        warn "  Xcode Command Line Tools が未導入だと発生します。次を実行してから再度お試しください:"
        warn "    xcode-select --install"
    else
        warn "  次の一手:"
        warn "    1. 上のログで原因を確認する"
        warn "    2. 解消後、次のコマンドで再試行する: cd \"$INSTALL_DIR\" && npm install"
    fi
    echo ""
    exit "$npm_install_exit"
fi
rm -f "$NPM_INSTALL_LOG"

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

# ─── Detect primary AI agent for Quick Start ───
if has claude; then
  AGENT_NAME="Claude Code"
elif has opencode; then
  AGENT_NAME="opencode"
else
  AGENT_NAME="AI エージェント"
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
echo -e "    2. ${AGENT_NAME} を起動（プロジェクトが自動生成される）"
echo -e "       ${MUTED}akari.sh${NC}"
echo ""
echo -e "    3. 別の端末でプレビューサーバーを起動"
echo -e "       ${MUTED}akari.sh --preview${NC}"
echo ""
echo -e "${MUTED}Docs: https://github.com/$REPO/blob/main/docs/getting-started.ja.md${NC}"
echo ""
