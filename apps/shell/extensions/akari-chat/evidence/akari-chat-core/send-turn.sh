#!/bin/bash
# 入力欄に 1 発話を入れて送り、ターンが終わる（「止める」が消える）まで待って最後の返事を出す。
# usage: AKARI_SHELL_DIR=<apps/shell> AKARI_CDP_PORT=<port> send-turn.sh "<発話>" [待つ秒]
C="$(dirname "$0")/cdp-l1.cjs"
node "$C" clicktext '[data-chat-input]' >/dev/null
node "$C" type '[data-chat-input]' "$1" >/dev/null
node "$C" key Enter >/dev/null
end=$((SECONDS + ${2:-240}))
until node "$C" eval "return !document.querySelector('[data-chat-stop]')" | grep -q true || [ $SECONDS -ge $end ]; do sleep 3; done
node "$C" eval "const a=[...document.querySelectorAll('[data-chat-role=assistant]')].pop(); return {busy: !!document.querySelector('[data-chat-stop]'), last: a && a.textContent.slice(0,300), alert: document.querySelector('[data-akari-chat] [role=alert]')?.textContent}"
