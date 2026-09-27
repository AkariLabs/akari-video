# 検証記録

- BEFORE: `before.json`。修正前の `generation-cli.ts` を Git object から実行して別モデルの 2 回目の拒否を再現。通常動画をローカル fal スタブで作り、edit.json のハッシュ変化と差し替え後の item を記録した。
- 型チェック: `npx tsc -b` 成功。
- lint: 成功（対象外の既存警告 1 件）。
- annotations: 2698 件中 2697 pass、1 fail。失敗は既知の vendored ffprobe 不在による `timeline-frame-audio-rpc`。
- packages/generate: 247/247 pass。
- L1: `l1-video-batch.mjs` を実行し、`l1-results.json` と `l1-results.md` に記録した。
- diff check: 成功。所有ファイル外の変更は 0 件。
