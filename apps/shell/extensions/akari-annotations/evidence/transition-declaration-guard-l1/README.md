# transition declaration guard — L1 証跡

並べ替え済みの gap-aware track engine 経路で、レンダー不能な `transition_out` を宣言時に止め、
既存宣言を日本語警告から除去できることを Electron + CDP の実 DOM で確認する。

## フェーズ

- phase a: 既存の非対応宣言を警告表示し、ワンクリック除去で lint PASS に戻ること。undo で
  宣言を戻した保存後 lint のバナーが、日本語要約と従来の英語詳細を併記すること
- phase b: 非対応順では境界ポップオーバーに日本語理由が出て種別ボタンが無効になり、JS で
  無効状態を外してクリックしても `edit.json` のバイト差分が 0 のまま拒否されること
- phase c: 既定順ではガードが出ず、従来どおりトランジションを付与できて lint PASS になること

実行は `scripts/run-l1.sh`。各フェーズでワークスペースと user-data-dir を作り直し、結果を
`phase-<phase>.json` と PNG へ保存する。

## 実測メモ

1. 既定ウィンドウ（1120×668）ではタイムライン段が高さ 26px のフッター帯の下に潜り、境界
   バッジ座標の `elementFromPoint` がフッターを返す。CDP 接続直後に
   `Emulation.setDeviceMetricsOverride` で 1680×1250 へ広げてから操作する。
2. Electron の workspace 引数をプロジェクトの親にすると、保存後 lint 通知の
   `projectRootUri` と widget の location root が一致せず、保存後バナーが出ない。workspace 引数は
   `<workspaceDir>/project` のプロジェクト実体を渡す。

## 実測値

`apps/shell` の production ビルド（`build:ext` + `theia build`）は 0 errors。Electron は
隔離 user-data-dir + CDP で起動し、フェーズごとに新規プロセスを使用した。
`scripts/run-l1.sh` は exit 0、3 フェーズすべて PASS。

| phase | 証跡 | 結果 | application shell ready |
|---|---|---|---:|
| a | `phase-a.json`、`phase-a-01-warning.png`、`phase-a-02-localized-banner.png` | PASS | 21,506ms |
| b | `phase-b.json`、`phase-b-guard.png` | PASS | 30,645ms |
| c | `phase-c.json`、`phase-c-transition-added.png` | PASS | 33,754ms |

### phase a — 既存宣言の警告・除去・日本語 lint バナー

- タイムラインは 1 回目の試行で open
- 警告バッジの hit 要素は `BUTTON`、高さ 19px。title は
  「このトランジション（映像トラック 1）は、並べ替えたトラックを合成する方式では書き出せません。
  削除するか、トラックを既定順へ戻してください。」
- ワンクリック除去で `transition_out` が消失し、`.akari/lint.json` は `verdict=pass`
- undo で宣言を戻すと、高さ 26px のフッター帯に
  「保存後の検証で問題が見つかりました: このトランジションは現在のトラック順では書き出せません。
  トランジションを削除するか、トラックを既定順へ戻してください。 詳細:
  [cuts.track-transition-unsupported] cuts[].transition_out is declared on track 0, …」と
  「直前の編集を元に戻す」ボタンを表示
- 再除去後は lint PASS で終了

### phase b — 宣言時ガード

- 境界ポップオーバーに日本語理由を表示
- 種別ボタン 3 個はすべて `disabled=[true,true,true]`
- disabled を JS で外して実クリックしても `editByteDiff=0`（`edit.json` はバイト同一）で、
  日本語の拒否通知を表示

### phase c — 既定順の非回帰

- `guardVisible=false`、種別ボタンは `disabled=[false,false,false]`
- クリックで `transition_out={type:'dissolve',duration:0.5}` が書き込まれ、lint PASS

### 書き出し実測（本スクリプト外）

`edit-lint` / `render-cut` CLI を併走して確認した。除去前は edit-lint が
`cuts.track-transition-unsupported` で FAIL し、render-cut も拒否。除去後は edit-lint が
0 findings で PASS し、render-cut も PASS。成果物 `exports/source.mp4` は 132,133 bytes、
映像 h264・640×360・10fps、音声 aac、duration 8.000s。
