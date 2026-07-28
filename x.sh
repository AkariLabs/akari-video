#!/usr/bin/env bash
# AKARI Video Preview Server 起動スクリプト
set -euo pipefail

PORT="${1:-3000}"
PROJECT="${2:-.}"

# サーバー起動
node packages/preview-server/src/server.mjs "$PROJECT" --port "$PORT" &
SERVER_PID=$!

# 終了時にサーバーも殺す
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM

sleep 1

# アクセス情報表示
WSL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "  ブラウザで以下を開いてください:"
echo ""
echo "    http://localhost:$PORT"
echo "    http://${WSL_IP}:${PORT}"
echo ""
echo "  Ctrl+C で停止"
echo ""

wait $SERVER_PID
