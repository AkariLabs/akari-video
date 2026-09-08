# evidence — partner-focus（`did not accept focus … akari-partner-onboarding` を消す）

タスク: `2026-09-09-partner-tab-focus-warning` / ブランチ `task/2026-09-09-partner-tab-focus-warning`

`run-l1.mjs` は検証専用ハーネス（製品コードではない）。隔離プロファイルで Electron を
1 本だけ起動し、`to 'ready'` 到達 ms と `Widget was activated, but did not accept focus
after 2000ms: <id>` の警告を数える。証跡に書く前に作業機のパスは `<WORKTREE>` /
`<HOME>` / `<TMP>` へ置換している。

```
node run-l1.mjs <label> <port> <outDir>
```

- 隔離: `HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` /
  `AKARI_CREDENTIALS_FILE` をすべて毎回の一時プロファイルへ向ける。実利用の
  `~/.theia` `~/.akari` `~/.config/akari-video` は読み書きしない
- Electron は detached にせず、計測ごとに PID 指名 SIGKILL → プロファイルパスで
  `ps` を引いて 0 件になるまで sweep。同時起動は 1 本まで
- 警告は stdout（`ELECTRON_ENABLE_LOGGING=1`）と CDP console の両方に二重に出るため、
  **widget id の集合**で数える（`focusWarnCount` = unique id 数）

## 実測（macOS 15.2 / Electron 39.8.7 / 2026-09-09）

| run | ready 到達 | `focusWarnCount` | `focusWarnIds` | 残存プロセス |
|---|---:|---:|---|---:|
| before-1 | 10174ms | 1 | `akari-partner-onboarding` | 0 |
| before-2 | 7619ms | 1 | `akari-partner-onboarding` | 0 |
| before-3 | 6535ms | 1 | `akari-partner-onboarding` | 0 |
| after-1 | 9150ms | **0** | — | 0 |
| after-2 | 6052ms | **0** | — | 0 |
| after-3 | 6195ms | **0** | — | 0 |

全 6 回で `ready` 到達。`layout initialization timed out` は BEFORE / AFTER とも 0 件。

`before-1.png` と `after-1.png` は **md5 が一致**（`c62921dcefc5c1184e187d511d961956`）。
見た目は 1px も変わっていない。

## 2000ms の正体（`logs/` の実測）

- `logs/before-1-log.txt`: `Changed application state from 'init' to 'started_contributions'`
  → `'started_contributions' to 'attached_shell'` の順（実測 5ms 差）。
  `akari-partner-contribution.ts` の `onStart()` が `activateWidget()` を呼ぶのは
  **`attachShell()` より前**なので、その瞬間の `this.node` はまだ document に載っていない
- detached な要素への `HTMLElement#focus()` は no-op のため、home 票と同じ
  「`onActivateRequest` で `tabIndex = -1` → `focus()`」だけでは focus が入らず、
  `ApplicationShell#assertActivated` の 2000ms ポーリングが空振りして warn する
  （実測: この 1 行だけの実装で L1 を 3 回回して 3/3 とも警告 1 件のまま）
- そこで `onActivateRequest` の中に「attach されるまでの短時間の再試行」を足した。
  attach は活性化から数 ms 後なので、16ms × 最大 60 回（約 1 秒）の再試行は
  `activationTimeout = 2000ms` の内側で必ず決着する
