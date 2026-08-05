# doctor 判定と導入・ログイン（人間手番の受け渡し）

## 1. doctor を実行する

```
node skills/setup-remote/bin/doctor.mjs
```

読み取り専用・ネットワーク設定を変更しない。JSON の `state` で分岐する:

| state | 意味 | 次の一手 |
|---|---|---|
| `not-installed` | tailscale の実体が見つからない | §2 導入ガイド |
| `app-not-running` | 実体はあるが CLI が応答しない（アプリ未起動・初回セットアップ未完が典型） | アプリを起動（`open -a Tailscale`）→ §3 ログイン → doctor 再実行 |
| `needs-login` | 導入済みだが未ログイン | §3 ログイン |
| `stopped` | ログイン済み・接続オフ | Tailscale アプリで接続をオンにしてもらう → doctor 再実行 |
| `running` | 接続中 | §4 スマホ側の確認へ |

## 2. 導入ガイド（人間手番 — ハードルール 3）

エージェントは代行しない。OS 別に手順を提示し、完了報告を受けたら doctor を再実行して確認する。

- **macOS**（どちらか）:
  - App Store 版（GUI・初心者向き）: App Store で「Tailscale」を検索して導入
  - Homebrew: `brew install --cask tailscale-app` — **.pkg インストーラーが sudo パスワードを
    対話で要求する**ため、エージェントのシェルからは完遂できない。ユーザー自身のターミナルで
    実行してもらう（Claude Code のセッション内なら `! brew install --cask tailscale-app` を案内）
- **Windows**: `winget install Tailscale.Tailscale` または公式インストーラー
  （https://tailscale.com/download/windows）
- **Linux**: 公式スクリプト（https://tailscale.com/download/linux）。`sudo` が要るのは同じく人間手番

## 3. ログイン（人間手番）

- Tailscale アプリを起動 → Google / GitHub / Apple 等でログイン
  （このアカウントが tailnet = 私設ネットワークの鍵になる。個人利用は無料枠で足りる）
- doctor 再実行で `state: running` を確認する

## 4. スマホ側（人間手番）

- App Store / Google Play で「Tailscale」を導入し、**PC と同じアカウント**でログイン
- VPN 構成の許可を承認する。「常時オン」を推奨 — スマホ側の Tailscale がオフだとリンクが
  開けないのが唯一のハマりどころなので、この時点でユーザーに明示的に伝える
- ここまで確認できたら [serve-preview.md](serve-preview.md) へ
