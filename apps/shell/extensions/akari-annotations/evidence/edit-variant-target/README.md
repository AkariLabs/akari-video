# edit-variant-target — L1 記録（#99 後半）

表示中のタイムライン（`edit.<slug>.json`）に、インスペクター・出力プレビューの字幕・書き出し対象の表示が働くことを、
Windows 11 実機の開発配置（`apps/shell` を Electron で直接起動・隔離した user-data / 設定 / `AKARI_HOME`）で確かめた記録。

## 隔離プロジェクト

| ファイル | 中身 |
|---|---|
| `edit.json` | V1 に `cut-a`（`clip-a.mp4`・赤）、V2 に `layer-a`「クリップ A」（同じ素材を 40% で重ねた動画レイヤー） |
| `edit.v20.json` | V1 に `cut-b`（`clip-b.mp4`・青）、V2 に `layer-b`「クリップ B」 |
| `captions.json` | 「エーのじまく」（0〜6 秒） |
| `captions.v20.json` | 「ブイニジュウのじまく」（0〜6 秒） |

字幕トラックはどちらも未宣言（暗黙補完）。出力プレビューが editUri から字幕ファイル名を導く経路を通す。

## 結果（ファイルは sha256 の先頭 16 桁）

| 手順 | 期待 | 実測 |
|---|---|---|
| 起動直後 | アクティブ = `edit.json`、書き出し対象の行なし | `edit.json`・行なし |
| v20 タブを選ぶ | アクティブ = `edit.v20.json`、メニューに「書き出し対象: edit.v20.json。…」 | 一致 |
| 1. v20 でクリップ B の音量を 0 → -6 dB | `edit.v20.json` だけ変わる | `edit.v20.json` c4097727… → 56eae92c…（`layer-b.source.gain_db: -6` が入る）、`edit.json` 531d96ab… のまま |
| 2. v20 の出力プレビュー | `captions.v20.json` の字幕 | editPath = `edit.v20.json`、字幕「ブイニジュウのじまく」が表示（画面 1） |
| 3. 書き出し対象の表示 | v20 と分かる | メニューの書き出しボタン下に「書き出し対象: edit.v20.json。別タイムラインは現在書き出せません。edit.json のタブに戻すと書き出せます。」（画面 1） |
| 4. `edit.json` タブへ戻す | アクティブ = `edit.json`、行が消える、クリップ A の音量で `edit.json` だけ変わる | アクティブ `edit.json`・行なし。音量 0 → -3 dB で `edit.json` 531d96ab… → 8827c255…（`layer-a.source.gain_db: -3`）、`edit.v20.json` 56eae92c… のまま。出力プレビューは `edit.json`・「エーのじまく」（画面 2） |

- 画面 1: `l1-v20-tab-inspector-preview-export.png`（v20 タブ・インスペクター音量 -6 dB・v20 の出力プレビューと字幕・メニューの書き出し対象の行）
- 画面 2: `l1-edit-json-tab-back.png`（edit.json タブ・インスペクター音量 -3 dB・edit.json の出力プレビューと字幕・書き出し対象の行なし）
- スクリーンショットは下端のステータスバー（アカウント名）と上端のタブ見出し（プロジェクトのパス）を黒で塗っている。

## 補足

- 操作は CDP（`Input.dispatchMouseEvent` / `Input.insertText`）。ウィンドウが OS の前面に無いため `Emulation.setFocusEmulationEnabled` を有効にして行った。
- 別タイムラインの出力プレビューは、タブ切り替えだけでは前面に出ないことがある（v20 のプレビュータブを選ぶと表示される）。出力プレビューの開き方は別レーン（#99 前半）の範囲。
- タブを切り替えた直後、インスペクターが前のタブで選んだクリップを表示し続けることがある。そのときの音量欄は無効になり、別ファイルへは書かれない（クリップを選び直すと正しい欄になる）。
