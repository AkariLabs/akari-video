# evidence — home の初期化が 2 秒で打ち切られていた件（task 2026-09-09-home-init-two-seconds）

`AkariHomeWidget` が focus を受け取れなかったため、Theia の `activateWidget` が
毎回 2 秒を使い切り、`akari-surfaces` の layout guard が打ち切られていた。
`onActivateRequest` で focus を受け取るようにし、`start()` の初期描画に要らない
3 段を最初の `update()` の後ろへ回した。その BEFORE / AFTER 実測。

## 2 秒の正体（Theia 実装の実測。`@theia/core/lib/browser/shell/application-shell.js`）

| 行 | 実装 | 効き方 |
|---|---|---|
| 192 | `this.activationTimeout = 2000` | 下 2 つの締切 |
| 1155-1159 | `activateWidget` は `Promise.all([waitForActivation(id), waitForRevealed(w), pendingUpdates])` を await | **await している側がここで待たされる** |
| 1161-1175 | `waitForActivation` は `activeWidget.id === id` になるまで resolve せず、`activationTimeout + 250` = 2250ms で reject | |
| 1225-1250 | `assertActivated` は `widget.node.contains(document.activeElement)` を `setTimeout` で監視し、2000ms 到達で `Widget was activated, but did not accept focus after 2000ms: <id>` を warn | 警告の出どころ |

`AkariHomeWidget` は focus を受け取る術を持たなかったので、この 2 秒を毎回使い切っていた。

## ハーネス

`run-l1.mjs`（ラッパー作成・検証専用。製品コードではない）

```
node run-l1.mjs <label> <port> <outDir> [workspace|-]
```

- `HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` / `AKARI_HOME` / `AKARI_CREDENTIALS_FILE`
  をすべて毎回の一時プロファイルへ向ける。実利用の `~/.theia` `~/.akari`
  `~/.config/akari-video` は読み書きしない
- Electron は detached にしない。計測後に PID 指名で SIGKILL し、
  `--user-data-dir` のパスで `ps` を引いて残骸が 0 になるまで掃く（`sweep()`）。
  Electron はバックエンドヘルパを ppid=1 で残すため親殺しだけでは足りない
- 同時起動は 1 本まで（BEFORE / AFTER を並列に起動しない）

計測項目: `readyMs`（起動 → `to 'ready'`）/ `homeSurfaceMs`（→ `[data-akari-home-stage]`）/
`homeReadyMs`（→ `[data-akari-home-ready="true"]`。AFTER のみ・属性が新規のため）/
`guardTimeouts` / `focusWarns` / `measures`（`akari-home:<step>` の内訳）。

## 結果 — 交互 A/B 10 組（1 回ごとに `lib` + `src-gen` を BEFORE ↔ AFTER で入れ替え）

シナリオはワークスペース無し（初回起動相当）で全 20 回とも共通。全 20 回 `ready` 到達。

| 組 | BEFORE ready | AFTER ready | 差 | B surface | A surface | A home-ready |
|---|---:|---:|---:|---:|---:|---:|
| ab1 | 8656 | 7782 | −10.1% | — | — | 7900 |
| ab2 | 10078 | 9086 | −9.8% | — | — | 8523 |
| ab3 | 14126 | 49666 | +251.6% | — | — | 113334 |
| ab4 | 28796 | 20692 | −28.1% | 29867 | 38767 | 38773 |
| ab5 | 19867 | 16302 | −17.9% | 17775 | 17940 | 18040 |
| ab6 | 20709 | 15176 | −26.7% | 18786 | 15236 | 15255 |
| ab7 | 13747 | 13939 | +1.4% | 11389 | 13764 | 13767 |
| ab8 | 14438 | 12103 | −16.2% | 12472 | 11761 | 12086 |
| ab9 | 15883 | 10096 | −36.4% | 13713 | 9742 | 9742 |
| ab10 | 10835 | 9719 | −10.3% | 8517 | 9507 | 9508 |

- `ready` 中央値: **14282 → 13021（−8.8%）**。ab3 を除く 9 組では 14438 → 12103（−16.2%）
- **AFTER ≦ BEFORE は 10 組中 8 組**
- ab1〜ab3 は surface / home-ready を CDP 往復のポーリングで測っていたため、
  高負荷時に往復自体が支配して「最初に観測した時刻」になった。ab4 以降はページ側の
  `waitForSelector` に切り替えてある（`—` は旧方式で未取得の意）

### ab3 は計測ノイズ（コード起因ではない）

ab3-after だけ `ready` が 49.7 秒。同じ run のログで
`Resolve plugins list ... [12.582 s since backend process start]`、
`akari-home:loadCreatorRootProjects` が **3306ms**（他 9 回の中央値 191ms、137 倍）。
`loadCreatorRootProjects` は BEFORE / AFTER で 1 行も変えていない共通経路なので、
この run はマシン側の I/O 停滞に支配されている。生データは残してある
（`measurements/measurements-ab3-after.json` / `logs/ab3-after-log.txt`）。

### 受け入れ条件の判定

| 条件 | 実測 |
|---|---|
| AFTER で `layout initialization timed out` 0 件 | **10 回すべて 0**（BEFORE は 10 回すべて 3 件） |
| AFTER で `did not accept focus … akari-home-widget` 0 件 | **10 回すべて 0**（BEFORE は 10 回すべて 3 件） |
| `ready` が BEFORE より悪化しない | 中央値 −8.8%（全 10 組）/ −16.2%（ab3 除く）。悪化ではなく短縮 |
| 起動後の残骸プロセス | 全 20 回 `leftoverProcesses: 0` |

AFTER に残る `did not accept focus` は `akari-partner-onboarding` の 1 件のみ
（home ではない・本票のファイル境界外）。

## `start()` の内訳（AFTER 10 回の中央値・ms）

| 段 | 中央値 | 位置 |
|---|---:|---|
| `refreshWelcomeMode` | 2.8 | 初期描画まで |
| `loadHomeFlow` | 0.5 | 初期描画まで |
| `loadCreatorRootProjects` | 191.4 | 初期描画まで |
| `loadStandaloneProjects` | 175.0 | 初期描画まで |
| `initializeFirstRunSetup` | 23.2 | 初期描画まで |
| `refreshCurrentLocation` | 16.8 | 初期描画まで |
| `initializeProjectLauncher` | 0.7 | **後段へ移動** |
| `loadUpdateStatus` | 119.0 | **後段へ移動** |
| `checkVersionNotice` | 269.1 | **後段へ移動** |

初期描画までの合計 **409.8ms** / 後段へ回した合計 **388.8ms**
（`start()` の直列待ちの約 49% が最初の描画の後ろへ退いた）。

移動の理由（1 段 1 行）:

- `initializeProjectLauncher` — 別モーダルを開くだけで、ホーム面のデータを作らない
- `loadUpdateStatus` — 更新バナーはホームの判定・一覧に依存されず、取得時に再描画される
- `checkVersionNotice` — 独立したトーストと起動記録の更新で、ホーム面のデータを作らない

`initializeFirstRunSetup` → `initializeProjectLauncher` の `firstRunWillAutoOpen`
受け渡しは維持している（順序は変えたが依存は保存。テストで固定済み）。

## ファイル

- `run-l1.mjs` — ハーネス
- `measurements/` — 20 回分の計測 JSON（BEFORE / AFTER × 10 組）
- `logs/` — 代表 5 本（ab1 の 2 本 / ab3-after = 外れ値 / ab10 の 2 本）
- `*.png` — ab1 / ab10 の BEFORE / AFTER スクリーンショット

作業機の絶対パスは `<WORKTREE>` / `<HOME>` / `<TMP>` に置換済み。
