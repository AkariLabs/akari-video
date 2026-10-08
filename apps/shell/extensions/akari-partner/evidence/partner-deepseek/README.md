# partner-deepseek — DeepSeek Harness CLI（dsh）追加の検証手順（2026-10-07）

対象: 接続カタログに **DeepSeek Harness CLI**（npm `@deepseek-ai/dsh`・bin `dsh`）を npm 経路で追加し、
セットアップ → 同意 → `npm install` → 検出 → PTY タブで `dsh web` まで一気通貫で通ること。
記録物（スクリーンショット・ターミナル文字列・ログ）はこのリポには置かず、タスクの記録側に保管する
（governance の evidence-growth 規約）。ここには再現スクリプトと手順だけを置く。

## 事実の確認（2026-10-07 時点）

- npm `@deepseek-ai/dsh` latest = `0.2.0-rc.2`（MIT）。`dsh --version` は `0.2.0-rc.2` を 1 行返す
- 利用規約: `https://platform.deepseek.com/downloads/DeepSeek%20Terms%20of%20Use.html` は 301 → `/404/` に落ちる。
  到達 200 を確認した `https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html`（ロケール 307 を経て 200）を採用
- ロゴ: `https://www.deepseek.com/` トップのヘッダー内インライン SVG ワードマーク（143x23）から鯨マークの path のみ抽出し、
  塗りを `#fff` に統一した 28x23 の SVG（SHA-256 `baf5e2ec…e88ab`。`partner-catalog.test.mjs` が固定値で照合）

## L0（ラッパーが実測）

```sh
cd apps/shell
npm run build:ext            # exit 0
npm run lint                 # akari-partner 配下の新規指摘 0
node --test extensions/akari-partner/src/node/*.test.mjs extensions/akari-partner/test/*.test.mjs
```

Windows（開発者モード無し）では `fs.symlink` が EPERM・`/bin/sh` 不在のため、基点でも `src/node` の 29 件が落ちる。
本変更後は 31 件で、増えた 2 件は Pi / Command Code の対応テストと同じ EPERM で落ちる DeepSeek の鏡像テスト
（`PATH 上の既存 DeepSeek Harness を再利用する`・`DeepSeek Harness は Node 22.18 では専用 Node を使い …`）。
基点との照合は、基点のテストファイルを `git show <base>:<file>` で取り出し、現行 `lib/` に向けた junction 経由で回して比較した。

## L1（dev shell を CDP で操作）

1. `npx theia start --plugins=local-dir:plugins --remote-debugging-port=9377 --user-data-dir=<UDD> <WS>` を
   `HOME` / `USERPROFILE` / `AKARI_HOME` / `THEIA_CONFIG_DIR` / `TEMP` を隔離ディレクトリに向けて起動する
   （画面が消灯していると起動が止まるので、接続後にまずスクリーンショットを 1 枚撮る）
2. `node cdp-catalog.cjs` — 右パネル「パートナーを追加」を開き、`[data-partner-entry]` の一覧と
   `.akari-partner-deepseek-cli-icon` の computed style を記録する
3. `node cdp-install.cjs` — `deepseek/dsh-cli` の「始める」→ 同意ダイアログ（取得元・利用条件リンクを記録）→「導入する」→
   完了まで待ち、PTY タブの xterm バッファを読む

結果（2026-10-07・Windows 11・システム Node v24.20.0 が PATH にある状態）:

- 右パネルに `DeepSeek Harness CLI / 始める` の行が 11 番目に出る。アイコンは 16x16 の mask（鯨）・テーマ文字色
- 同意ダイアログのリンク = `https://registry.npmjs.org/@deepseek-ai/dsh` と `https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html`
- `npm install --global --prefix <HOME>/.local` が約 4 分で完了し `<HOME>/.local/dsh.cmd` が生成される（私用 Node は取得されない = `nodeSource: system`）
- PTY タブ `DeepSeek Harness CLI`（iconClass `akari-partner-deepseek-cli-icon`）が開き、
  `cmd.exe /d /s /c <HOME>\.local\dsh.cmd web` が起動。バッファに
  `dsh web: http://127.0.0.1:3080/?token=…` と `dsh web: opening the default browser; pass --no-open to disable` が出る。
  `curl http://127.0.0.1:3080/` は 401（token 無し）= サーバー稼働
- 左カタログ（`vsx-extensions-view-container`）は akari-shell-strip の allowlist で非表示（基点からの既存挙動・全エージェント共通）

## 申し送り

- `cmd /d /s /c <shim> web` は shim のパスに空白が無ければ `web` が届く（`DSH_ARGS=[web]` を実測）。
  パスに空白があると `/s` の引用剥がしで `web` の有無に関係なく失敗する — Pi / Command Code の `.cmd` 経路と同じ既存の制約
- `tui` プロファイルが同梱されたら `resolvePartnerProcessLaunch` の `['web']` を `['tui']` に差し替える
