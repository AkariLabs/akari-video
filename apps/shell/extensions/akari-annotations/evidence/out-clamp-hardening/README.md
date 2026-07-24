# evidence: out-clamp-hardening

Out トリム実尺クランプ（第 9 報⑨で実装、第 10 報⑮でオーナー実機「まだ無限に伸びる」と
再発報告）の根治レーンの L1 実測記録。

## 根因（3 つとも実コード読解で特定・実測で確認）

1. **初回ドラッグの素通し**（`akari-annotations-widget.ts` `updateDragPreview`）:
   `videoDurationCache` が未取得（`undefined`）のとき `fetchVideoDuration()` を
   fire-and-forget で呼ぶだけで、そのフレームの `maxOutSeconds` は `undefined` のまま
   ドラッグが進行していた。ドラッグが pointerup まで速く終わると、フェッチ未完了のまま
   無制限の値がサーバへ送られていた。
2. **sidecar 依存の videoUri 解決**（`akari-annotations-contribution.ts`
   `resolveProjectLocation`）: `this.location.videoUri` は
   `.akari/sidecars/**/*.analysis/analysis.json` の `source` フィールドからしか解決されず、
   このサイドカーが無いプロジェクト（素の `edit.json` のみ）では空文字になる。
   旧 `cutVideoUri()` はこれを実尺取得にも流用していたため、`videoUri` が空 →
   `if (state.edge === 'right' && videoUri)` の外側の条件が **false** になり、
   クランプ判定そのものがスキップされていた。**さらに悪いことに、この分岐の外では
   警告も一切出ない**（`showVideoDurationUnavailableNotice()` は `videoUri` が
   truthy な場合の内側でしか呼ばれていなかった）— 完全な沈黙のフォールスルー。
   一方、edit.json スキーマ（`packages/schemas/edit.schema.json` `editV0`）は
   sidecar 抜きでも `source.path` を必須で持っているため、sidecar を経由しなくても
   実尺解決に使える一次情報がそもそも edit.json 自身に存在していた。
3. **v1 マルチソース**: `cutVideoUri()` の `sourceMap` 経由の解決自体は元々
   sidecar 非依存だった（`sources[].path` を `edit.json` からその場で解決）。
   ただし上記 2 と同じく「解決失敗時に無警告でクランプが無効化される」という
   構造上の弱点は共有していた。

## 対応（4 層防御、すべて `apps/shell/extensions/akari-annotations/**` 内で完結）

1. `pointerdown` 時に Out 側トリムなら実尺フェッチを先行キック
   （`ensureVideoDurationFetch`）+ `commitDrag` 側で未解決なら確定を保留して
   フェッチの完了を待ってからクランプ（「初回だけ素通し」を構造的に不可能にする）
2. `cutDurationProbeUri()` を新設し、実尺取得だけは
   sidecar（`this.location.videoUri`）に頼らず、まず edit.json 自身の
   source(s)（v1: `sources[]`、v0: 直下の `source`）から解決する
   （`cutVideoUri()` 自体はサムネ/波形用に無変更 — 契約の「サムネ/波形の URI 解決改善はしない」を厳守）
3. サーバ側 `trimCut()` も `maxOutSeconds` 未指定時、edit.json の生テキストを
   その場でパースして同じ経路（v1/v0 source）から動画パスを解決し、既存
   `media-cache.getAudioDuration`（ffprobe）で自衛的に実尺を取得してクランプする
   （クライアントを経由しない多重防御）
4. 実尺がどうしても解決できない場合のみクランプなしを許容しつつ、
   **ドラッグのたびに** ghost の `akari-annotations-ghost-duration-warning`
   クラス（既存の rejected 警告色 `#f14c4c` を再利用）+ drag feedback テキスト
   （`⚠ 実尺不明のため無制限`）で視認できる警告を出す
   （旧: 1 回きりの `showNotice` のみ → 見落とし報告あり）

## L1 実測環境

production ビルド（`npm run build`、browser/node/electron とも 0 errors）の Electron を
隔離 `--user-data-dir` + `--remote-debugging-port` で `--no-sandbox` 起動し、生 CDP
（`scripts/cdp-lib.mjs`、`evidence/timeline-tracks` から流用）で実際のマウスイベントを
ディスパッチして操作した。3 つの独立ワークスペースを `scripts/prepare-workspaces.sh` で
`fixtures/{fresh-open,no-sidecar,unresolvable}/` から都度生成（動画は ffmpeg lavfi で
実尺 6.000000 秒ちょうどを都度生成 — バイナリはコミットしない）。

再現コマンド:

```sh
cd apps/shell
scripts_dir=extensions/akari-annotations/evidence/out-clamp-hardening/scripts
"$scripts_dir/prepare-workspaces.sh" /tmp/<scratch>
# Electron を隔離 port/user-data-dir で起動した後:
node "$scripts_dir/run-l1.mjs" fresh-open    <port> /tmp/<scratch>/fresh-open    <evidenceDir>
node "$scripts_dir/run-l1.mjs" no-sidecar    <port> /tmp/<scratch>/no-sidecar    <evidenceDir>
node "$scripts_dir/run-l1.mjs" unresolvable  <port> /tmp/<scratch>/unresolvable  <evidenceDir>
```

## 受け入れ条件と実測結果

| # | 条件 | 結果 | 実測値 |
|---|---|---|---|
| 1 | 開いた直後の初回ドラッグで実尺を超えられない | **PASS** | `fresh-open`: pointerdown→即 pointerup（レース最大化）で out を 2→15 秒へ提案 → **out:6**（実尺 ffprobe 実測 6.000000s と一致）で確定。`run-log-fresh-open.json` |
| 2 | sidecar なしプロジェクトでもクランプが効く | **PASS** | `no-sidecar`（`.akari/` ディレクトリ自体が存在しない）で同じ初回ドラッグ実測 → **out:6**。`run-log-no-sidecar.json` |
| 3 | 実尺不明時、ドラッグのたびに視認可能な警告 | **PASS** | `unresolvable`（`source.path` が存在しないファイル）で 2 回ドラッグ、**両方**でドラッグ中に ghost の `akari-annotations-ghost-duration-warning` クラス + feedback「⚠ 実尺不明のため無制限」を実測（`unresolvable-01-mid-drag-warning.png` / `-02-`）。クランプ対象実尺が無いため out は無制限のまま（`out:112.25` — 契約が明記する「実尺不明時はクランプなし」どおりの仕様動作） |
| 4 | 回帰: 通常クランプ・トリム/スナップ/undo | **PASS** | `fresh-open`/`no-sidecar` とも、クランプ後の通常範囲内トリム（実尺内で Out を縮める）が反映され、⌘Z で直前の値へ厳密復元することを実測 |

## 検証プロセスの後始末

L1 実測完了後、各ワークスペースの Electron（メイン + GPU/network/renderer/utility
ヘルパー含む全 PID）を `ps aux` で実 PID 確認のうえ `kill -9` し、`ps aux` で
残存プロセスがゼロであることを確認済み。ワークスペース実体（`/tmp/ocb-verify-ws/**`、
生成した動画含む）はリポジトリ外（scratch）のため、リポジトリには残さない。
