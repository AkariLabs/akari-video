# lockfile-refresh — 証跡

package-lock の刷新（0.1.33 時点 → 現物 0.1.57）と、拡張間 `file:` 依存 ⇄ `build:ext` 順序の
機械照合（`scripts/ci/check-extension-deps.mjs`）の検証記録。

- 計測: 2026-09-09 01:33–01:43 JST / macOS arm64 (Darwin 25.2.0) / Node 26.3.0 / npm 11.16.0
- 対象: ブランチ `task/2026-09-08-lockfile-refresh-and-build-order`（`83c07baa..` の 2 コミット）
- 手順: `git clone` した**新規クローン**（worktree の node_modules を使わない）で CI の
  L0 / unit と同じ順に実行。ローカル絶対パスは `<CLONE>` / `<REPO>` / `<WORKTREE>` へ置換

## 実測値（`l0-fresh-clone.txt`）

| # | 手順 | 結果 | 実測 |
|---|---|---|---|
| 01 | root `npm install --package-lock-only --ignore-scripts` | exit 0 | `git diff package-lock.json` = **0 行**（up to date in 9s） |
| 02 | apps/shell `npm install --package-lock-only --no-workspaces --ignore-scripts` | exit 0 | `git diff apps/shell/package-lock.json` = **0 行**（up to date in 5s） |
| 04 | root `npm ci --ignore-scripts` | exit 0 | added 1479 packages / 140.9 s |
| 05 | apps/shell `npm ci --no-workspaces --ignore-scripts` | exit 0 | added 1400 packages / 66.1 s |
| 06 | apps/shell `npm run build:ext`（tsc -b 9 拡張） | exit 0 | 24.5 s |
| 07 | root `npm run test:shell`（lane shell） | exit 0 | tests 3167 / pass 3167 / **fail 0** / 60.4 s |
| 08 | root `node scripts/ci/run-unit-tests.mjs --lane pure` | exit 0 | tests 1908 / pass 1902 / **fail 0** / skipped 6 / 170.1 s |
| 09 | root `node scripts/ci/check-extension-deps.mjs` | exit 0 | 9 extensions / 421 files / 39 imports |
| 11 | apps/shell `npm run lint`（eslint） | exit 0 | 11.1 s / 指摘 0 |
| 12 | root `node scripts/gen-skills-index.mjs --check --strict` | exit 0 | drift なし（23 件） |
| 13 | root `node scripts/check-docs-sync.mjs` | exit 0 | drift なし（スキル 23 / 契約 65） |

01・02 の diff 0 行が「lock が現物と一致している」の実測。lock 記録の版も
`apps/shell` = 0.1.57 / `packages/akari-launcher` = 0.1.57（`lock-diff-classification.txt`）。

## lock 差分の分類（`lock-diff-classification.txt`）

`main` の lock と本ブランチの lock をパッケージ名で突き合わせた結果:

- root: エントリ 1693 → 1568 / 名前 1226 → 1146。**追加 0 名・完全削除 80 名・版集合変更 34 名**
- apps/shell: エントリ 1466 → 1466。**追加 0・削除 0・版変更 0**（記録された自分の版だけ 0.1.14 → 0.1.57）

削除 80 名は `hyperframes` とその推移クロージャ（`sharp` / `@img/*` / `@google/genai` /
`protobufjs` / `fontkit` / `onnxruntime` の重複版など）。版集合変更 34 名も大半は同じクロージャが
持ち込んでいた二重版の解消（例 `esbuild: 0.24.2,0.25.12 → 0.24.2`、`open: 7.4.2,10.2.0 → 7.4.2`）。

## 削除された依存の根拠（`removed-deps-audit.txt`）

削除 80 名それぞれについて `git grep`（追跡ファイルのみ）で照合した結果:

- どの `package.json` にも依存宣言 **0 件**
- ソースからの `import` / `require` **0 件**
- `scripts/release/**` と `apps/shell/resources/scripts/**` からの名指し **8 件、すべてコメント**
  - `bundle-cli-node-modules.mjs:25` / `bundled-cli-npm-entries.mjs:24-25` /
    `generate-third-party-notices.mjs:140` / `check-packaged-imports.mjs:21` —
    いずれも「hyperframes は**同梱しない**」判断の理由を書いたコメント（sharp の言及も同じ文中）
  - 残り 3 件は `long` が `alongside` / `along with` に部分一致した誤検出
    （`generate-third-party-notices.mjs:277`、`license-texts/Apache-2.0.txt:114,119`）

→ 名指しで**必要としている**削除依存は無く、package.json 側へ依存を足して引き止める必要は無かった。

## 退行実証（`negative-build-ext-order.txt`）

新規クローン内で `build:ext` の `tsc -b` 列挙から `akari-theme` を末尾へ戻す（設定票以前の順序）と
`node scripts/ci/check-extension-deps.mjs` は **exit 1**、違反 7 件を根拠行つきで列挙する。
確認後は `git checkout -- apps/shell/package.json` で復旧し、再実行が exit 0 に戻ることも確認済み。

## 未実行

`ci.yml` への組み込みは本票の対象外（CI 設定は編集禁止）。`node scripts/ci/check-extension-deps.mjs`
を手で叩いて exit 0 になる状態までが本票の範囲。
