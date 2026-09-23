# Issue 79: v2 snapshot の読み取り

`node skills/compile-review-session/evidence/issue-79/reproduce.mjs` で、一時 HOME に旧 CLI（0.1.40）と新しいデスクトップ版 Resources（0.1.79）を作る。コピーしたスキルから `--prepare-only --json` を実行する。BEFORE は旧探索順を一時コピーで再現し、AFTER は新版の edit-store を選ぶ。UNKNOWN は compile-report.md に未知キーの警告が残り、snapshot が不変であることを示す。BAD_TYPE は型の誤りで停止する。外部メディアツールは不要。
