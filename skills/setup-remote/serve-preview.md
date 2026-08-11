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
- 開けない場合の切り分け順:
  1. スマホ側の Tailscale がオンか（最頻出の原因）
  2. **TLS ハンドシェイクで止まる場合は証明書**。管理コンソールで HTTPS Certificates が
     有効か確認する。有効なのに失敗するなら `tailscale cert <dnsName>` を単体実行して
     ACME のエラー本文を読む（発行が invalid なら tailnet 側の問題で、serve の設定ミスではない）
  3. マシンがスリープしていないか（寝ると tailnet から消える）

## 4. 承認レポートを serve する（必要なとき）

承認ゲートをスマホで回す場合は、decision-cards レポートヘルパーも serve する。
**許可リストはプレビューサーバーとこのヘルパーの 2 件だけ**（ハードルール 2）。

1. ヘルパーを起動する（`<port>` は空きポート。標準出力に `HELPER: http://localhost:<port>/`）:
   ```
   node packages/decision-cards/report-helper.mjs <report.html のパス> --port <port>
   ```
2. serve 設定（承認必須 — ハードルール 4）。コマンド・効果・解除方法を提示して承認を得る:
   ```
   tailscale serve --bg --https=8443 <port>
   ```
   - 効果: `https://<マシン名>.<tailnet 名>.ts.net:8443` → `localhost:<port>`。tailnet 内限定
   - 外部ポートを 8443 に固定するため、ヘルパーの内部ポートが起動ごとに変わっても
     **チャットに貼った URL は死なない**
   - 解除: `tailscale serve --https=8443 off`（プレビュー側は残る）
3. スマホで開き、カードを 1 つ操作 → `<report.html>.decisions.json` が実際に更新されることを
   Mac 側で確認する。**表示できただけで完了と言わない**（ハードルール 6）
