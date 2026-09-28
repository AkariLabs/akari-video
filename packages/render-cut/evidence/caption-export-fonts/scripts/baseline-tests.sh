#!/bin/bash
# 基点 1a3a015f5 の複製で既存テストを流す（検証専用）
export NO_COLOR=1; unset FORCE_COLOR
B=<base-copy>
cd $B
( cd packages/frame-engine && npm run build ) > /tmp/cef-base-frame-engine.log 2>&1
( cd apps/shell && npm run build:ext ) > /tmp/cef-base-build-ext.log 2>&1; echo "build:ext exit=$?" >> /tmp/cef-base-build-ext.log
for p in render-cut osr-export gpu-export preview-server; do ( cd packages/$p && /usr/bin/time -p npm test ) > /tmp/cef-base-test-$p.log 2>&1; echo "exit=$?" >> /tmp/cef-base-test-$p.log; done
/usr/bin/time -p npm run test:shell > /tmp/cef-base-test-shell.log 2>&1; echo "exit=$?" >> /tmp/cef-base-test-shell.log
echo done > /tmp/cef-base-done
