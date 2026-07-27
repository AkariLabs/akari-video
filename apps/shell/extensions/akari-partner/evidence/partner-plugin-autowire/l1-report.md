# L1 実測ログ — task/2026-07-25-partner-plugin-autowire

実行日時: 2026-07-25T11:49:01Z（UTC）
claude 実体（実測に使用）: <HOME>/.local/share/claude/versions/2.1.220（version 2.1.220、ホームディレクトリ差し替え下で symlink 経由・(a)(e)(f) は実 CLI 実行、(b)(c)(d) は呼び出し記録スタブに差し替え）
REPO_ROOT: <WORKTREE>
harness: apps/shell/extensions/akari-partner/evidence/partner-plugin-autowire/l1-harness.js（このリポ配下に保存済み。HOME / AKARI_PARTNER_WORKSPACE_ROOT を差し替えたスクラッチ配下で、本番と同じ toString() 直列化 `node -e` 経路でコンパイル済み bootstrap-runner.js を実行）

## a — a) unwired + marketplace known -> install runs in project cwd

- 結果: PASS
- exitCode: 0
- settings.json (before): `null`
- settings.json (after): `{"enabledPlugins":{"akari@akari":true}}`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/a-home/.local/bin/claude
Installing plugin "akari@akari"...✔ Successfully installed plugin: akari@akari (scope: project)
akari プラグインを配線しました（project scope: /tmp/akari-plugin-autowire-l1/a-project）
{"executablePath":"/tmp/akari-plugin-autowire-l1/a-home/.local/bin/claude","reused":true}
```

## b — b) enabledPlugins already present -> install NOT called

- 結果: PASS
- exitCode: 0
- stub claude 呼び出し: false
- settings.json (before): `{"enabledPlugins":{"akari@akari":true}}`
- settings.json (after): `{"enabledPlugins":{"akari@akari":true}}`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/b-home/.local/bin/claude
akari プラグイン配線済み
{"executablePath":"/tmp/akari-plugin-autowire-l1/b-home/.local/bin/claude","reused":true}
```

## c — c) marketplace unknown -> skip install, warn, bootstrap succeeds

- 結果: PASS
- exitCode: 0
- stub claude 呼び出し: false
- settings.json (after): `null`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/c-home/.local/bin/claude
akari マーケットプレイスが未登録のため、スキル配線は手動が必要です
{"executablePath":"/tmp/akari-plugin-autowire-l1/c-home/.local/bin/claude","reused":true}
```

## d — d) install exits non-zero -> bootstrap succeeds with a warning

- 結果: PASS
- exitCode: 0
- stub claude 呼び出し: true
- stub 呼び出し記録: `{"argv":"plugin install akari@akari --scope project","cwd":"<scratch>/d-project"}`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/d-home/.local/bin/claude
akari プラグインの配線に失敗しました。スキル配線は手動が必要です（接続は続行します）: /tmp/akari-plugin-autowire-l1/d-home/.local/bin/claude exited with code 7
{"executablePath":"/tmp/akari-plugin-autowire-l1/d-home/.local/bin/claude","reused":true}
```

## noWorkspace — (prereq) no workspace root -> wiring step skipped, bootstrap succeeds

- 結果: PASS
- exitCode: 0
- stub claude 呼び出し: false
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/noworkspace-home/.local/bin/claude
プラグイン配線: プロジェクトの workspace が見つからないためスキップします
{"executablePath":"/tmp/akari-plugin-autowire-l1/noworkspace-home/.local/bin/claude","reused":true}
```

## e — e) pre-existing settings.json (permissions) -> non-destructive merge (REAL claude CLI)

- 結果: PASS
- exitCode: 0
- settings.json (before): `{"permissions":{"allow":["Read(./**)","Edit(./planning/**)","Edit(./exports/**)"],"deny":["Edit(/assets/**)"]}}`
- settings.json (after): `{"permissions":{"allow":["Read(./**)","Edit(./planning/**)","Edit(./exports/**)"],"deny":["Edit(/assets/**)"]},"enabledPlugins":{"akari@akari":true}}`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/e-home/.local/bin/claude
Installing plugin "akari@akari"...✔ Successfully installed plugin: akari@akari (scope: project)
akari プラグインを配線しました（project scope: /tmp/akari-plugin-autowire-l1/e-project）
{"executablePath":"/tmp/akari-plugin-autowire-l1/e-home/.local/bin/claude","reused":true}
```

## f — f) user-scope ~/.claude/settings.json enabledPlugins unaffected by --scope project install

- 結果: PASS
- exitCode: 0
- user-scope settings.json (before): `{"extraKnownMarketplaces":{"akari":{"source":{"source":"directory","path":"<WORKTREE>"}}}}`
- user-scope settings.json (after): `{"extraKnownMarketplaces":{"akari":{"source":{"source":"directory","path":"<WORKTREE>"}}}}`
- stdout:
```
既存の claude を検出: /tmp/akari-plugin-autowire-l1/f-home/.local/bin/claude
Installing plugin "akari@akari"...✔ Successfully installed plugin: akari@akari (scope: project)
akari プラグインを配線しました（project scope: /tmp/akari-plugin-autowire-l1/f-project）
{"executablePath":"/tmp/akari-plugin-autowire-l1/f-home/.local/bin/claude","reused":true}
```

## 総合

全シナリオ PASS
