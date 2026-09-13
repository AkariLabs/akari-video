# `akari generate still` L1 証跡

このディレクトリはラッパーが Codex 実生成 3 枚の L1 を実行し、PNG・meta・edit.json と実測所要秒を収録するための置き場です。

入力は `packages/generate/test/fixtures/cli-still/l1-project/` を一時領域へ複製し、`akari generate still <project-dir> --spec <project-dir>/beats.json --parallel 3` で実行します。

証跡へ絶対パスを記録するときは作業場所を `<WORKTREE>`、ホームを `<HOME>`、一時領域を `<TMP>` に置換します。
