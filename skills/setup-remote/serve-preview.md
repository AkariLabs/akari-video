# プレビューサーバーの tailnet 限定公開

## 1. プレビューサーバーの起動確認

- doctor の `preview.listening` が false なら起動する: `./akari.sh --preview`
  （または `npx akari-video --preview`）。既定ポート 4567
- doctor 再実行で `preview.listening: true` を確認

## 2. serve 設定（承認必須 — ハードルール 4）

実行前に、コマンド・効果・解除方法の 3 点セットを提示して承認を得る:

```
tailscale serve --bg 4567
```

- 効果: `https://<マシン名>.<tailnet 名>.ts.net` → `localhost:4567` の転送。
  **tailnet 内のデバイスだけが到達できる**（公開インターネットには出ない。funnel とは別物 —
  funnel はハードルール 1 により扱わない）
- 解除: `tailscale serve reset`（serve 設定の全解除）
- 旧 CLI では `serve` の構文が異なることがある。エラーになる場合は `tailscale version` を確認し、
  公式 serve ドキュメントの当該版の構文に合わせる（それでも対象はプレビューサーバーのみ —
  ハードルール 2）

## 3. URL の確定と閲覧確認

- doctor 再実行 → `serve.configured: true` と `serveUrl` を確認
- スマホ（Tailscale オン）で `serveUrl` を開いてもらい、プレビューが表示されることを確認
- 表示されたら [taildrop-inbox.md](taildrop-inbox.md) へ。開けない場合はまずスマホ側の
  Tailscale がオンかを確認する（最頻出の原因）
