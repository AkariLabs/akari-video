---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-08-12
---

# first-run-onboarding-v0 L1 検証手順

`capture.mjs` は `verify` スキルの L1 手順（production Electron 直起動 +
Playwright の CDP 接続）で、隔離した `HOME` / `AKARI_HOME` / Theia profile を使う。
親プロセスは共通の `AKARI_HOME` と出力先だけを管理し、launch 1 / launch 2 は
それぞれ独立した Node 子プロセスで実行する。各子プロセスは CDP 接続を 1 回だけ行い、
例外時を含めて自分が起動した Electron の実 PID だけを終了する。
実行すると次を実クリック・実ファイル確認し、同ディレクトリへ PNG 7 枚と
`observations.json` を保存する。

1. 完全初回に `first-run-setup` が自動表示され、7 道具の実測結果が出る
2. 「作業場を作成」で既存 `ensureCreatorRoot()` が走り、`creator-root.json` と
   `.akari/root.json`（`creator-root/v1`）が生成される
3. 「パートナーに接続」で既存 01 ゲートが開く（外部ログインはせずキャンセル）
4. 01 ゲートを閉じると dashboard へ遷移する
5. 同じ `AKARI_HOME` + 新規 Theia profile で再起動すると自動表示されず、ウェルカム面には再表示導線がある
6. コマンドパレットの「初回セットアップを開く」で再表示できる

実行コマンド:

```sh
cd apps/shell
node extensions/akari-surfaces/evidence/first-run-onboarding-v0/capture.mjs
```

## このハーネスでの実行結果

実機証跡はサンドボックス外の GUI セッションを持つラッパーが上記コマンドで取得する。
2026-08-12 の実機切り分けでは launch 1 の画面遷移と 01 ゲートまでが成功し、
`01-tools-check.png` から `05-dashboard.png` までの 5 枚を取得済みである。

改修後のハーネスの完了条件は、同じ `AKARI_HOME` を引き継いだ別 Node 子プロセスで
launch 2 を実行し、`06-second-launch-no-auto-setup.png` と `07-command-reopen.png` を
加えた PNG 7 枚、および両 launch の `observations.json` が揃うこととする。各実行後は
起動した Electron の実 PID と一時 HOME / 作業場だけを削除し、通常の `~/.akari` と
`~/Akari` には触れない。
