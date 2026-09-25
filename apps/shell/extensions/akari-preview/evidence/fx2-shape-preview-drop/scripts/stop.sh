#!/bin/bash
# 本票が起動した Electron（この worktree / 基点の展開先の electron と、本票専用の一時名）だけを PID で止める。使い方: bash stop.sh <electron のパスに含まれる文字列>
PAT=${1:?}
for p in $(pgrep -f "$PAT"); do kill -TERM "$p" 2>/dev/null; done; sleep 6
for p in $(pgrep -f "$PAT"); do kill -KILL "$p" 2>/dev/null; done; sleep 1
echo "remaining=$(pgrep -f "$PAT" | wc -l | tr -d ' ')"
