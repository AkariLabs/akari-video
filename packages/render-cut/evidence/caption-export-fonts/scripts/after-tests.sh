#!/bin/bash
# worktree で既存テスト・drift 検査を流す（検証専用）
export NO_COLOR=1; unset FORCE_COLOR
W=<repo>
cd $W
for p in render-cut osr-export gpu-export preview-server; do ( cd packages/$p && /usr/bin/time -p npm test ) > /tmp/cef-after-test-$p.log 2>&1; echo "exit=$?" >> /tmp/cef-after-test-$p.log; done
/usr/bin/time -p npm run test:shell > /tmp/cef-after-test-shell.log 2>&1; echo "exit=$?" >> /tmp/cef-after-test-shell.log
node scripts/ci/check-frame-engine-drift.mjs > /tmp/cef-after-drift-fe.log 2>&1; echo "exit=$?" >> /tmp/cef-after-drift-fe.log
node scripts/ci/check-preview-server-drift.mjs > /tmp/cef-after-drift-ps.log 2>&1; echo "exit=$?" >> /tmp/cef-after-drift-ps.log
echo done > /tmp/cef-after-done
