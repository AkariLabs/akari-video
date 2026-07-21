#!/usr/bin/env bash
# 役目を終えた git worktree（akari-video-wt/ 配下のレーン）を安全に削除する。
#
# 削除条件（全て満たした worktree のみ）:
#   1. ブランチが main に取り込み済み（merge-base --is-ancestor）
#   2. 未コミット変更がない（無視: .lane-alive / tsconfig.tsbuildinfo / package-lock.json）
#   3. その worktree をカレントディレクトリにするプロセスが存在しない
#   4. .lane-alive の最終更新が LANE_QUIET_MIN 分より古い（レーン生存マーカー）
#   5. ソースファイルの最終更新が QUIET_MIN 分より古い（node_modules/.git 除く）
#
# 使い方:
#   scripts/prune-worktrees.sh          # dry-run（削除対象を表示するだけ）
#   scripts/prune-worktrees.sh --yes    # 実際に削除
#
# 自動化する場合の cron 例（毎日 06:00）:
#   0 6 * * * /Users/ryoma/_edit/30_products/akari-video/scripts/prune-worktrees.sh --yes >> ~/Library/Logs/akari-prune-worktrees.log 2>&1
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT_ROOT="$(dirname "$REPO_ROOT")/akari-video-wt"
QUIET_MIN="${QUIET_MIN:-120}"
LANE_QUIET_MIN="${LANE_QUIET_MIN:-60}"
JUNK_PATTERN='\.lane-alive|tsconfig\.tsbuildinfo|package-lock\.json'
APPLY=false
[[ "${1:-}" == "--yes" ]] && APPLY=true

[[ -d "$WT_ROOT" ]] || { echo "worktree ルートがありません: $WT_ROOT"; exit 0; }

removed=0 skipped=0
for wt in "$WT_ROOT"/*/; do
    name="$(basename "$wt")"
    branch="$(git -C "$wt" branch --show-current 2>/dev/null || true)"
    if [[ -z "$branch" ]]; then
        echo "skip  $name: ブランチを特定できません"
        skipped=$((skipped + 1)); continue
    fi
    if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$branch" main 2>/dev/null; then
        echo "skip  $name: main 未取込（${branch}）"
        skipped=$((skipped + 1)); continue
    fi
    if git -C "$wt" status --porcelain | grep -Evq "$JUNK_PATTERN"; then
        echo "skip  $name: 未コミット変更あり"
        skipped=$((skipped + 1)); continue
    fi
    if ps -eo command= | grep -F "${wt%/}" | grep -vq grep; then
        echo "skip  $name: 使用中プロセスあり"
        skipped=$((skipped + 1)); continue
    fi
    if [[ -n "$(find "$wt.lane-alive" -mmin "-$LANE_QUIET_MIN" 2>/dev/null)" ]]; then
        echo "skip  $name: レーン生存マーカーが新しい"
        skipped=$((skipped + 1)); continue
    fi
    if [[ -n "$(find "$wt" \( -name node_modules -o -name .git \) -prune -o -type f -mmin "-$QUIET_MIN" -print 2>/dev/null | head -1)" ]]; then
        echo "skip  $name: 最近更新されたファイルあり"
        skipped=$((skipped + 1)); continue
    fi
    if $APPLY; then
        git -C "$REPO_ROOT" worktree remove --force "$wt"
        echo "削除  ${name}（${branch}）"
        removed=$((removed + 1))
    else
        echo "対象  ${name}（${branch}）— --yes で削除"
        removed=$((removed + 1))
    fi
done
git -C "$REPO_ROOT" worktree prune

$APPLY && echo "完了: ${removed}本削除 / ${skipped}本スキップ" \
       || echo "dry-run: ${removed}本が削除対象 / ${skipped}本スキップ（実行は --yes）"
