# ライブラリの「使う」を参照にする（シェル採用）— L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`、その後 libffmpeg を stock 版 = `H264 Decoder` 1 件に差し替えてアドホック再署名）の Electron を直接起動。CDP ポート 9431
- `AKARI_HOME` / `AKARI_LIBRARY_ROOT` / `AKARI_CREATOR_ROOT` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `/tmp/lris-l1/` 配下（実機の `~/.akari`・`~/Akari` は不使用）
- 置き場の素材は本物の CLI（`akari-assets add --plan` → `--apply`）で 3 本入れた: `audio/ref-beep`（1.5 秒の wav・sfx）/ `broll/ref-broll`（4 秒の testsrc2 mp4）/ `still/ref-still`（橙の png）。いずれも `origin:own`
- Lab 素材は本物のカタログから `audio/sfx-bell-tree`
- プロジェクトは `templates/project-default` の複製 + 6 秒の `assets/base.mp4` + 映像 1 行（cut-1 / cut-2）+ A1。git 管理して差分を見た
- 操作は実マウスクリック（`scripts/cdp.mjs` + `../materials-tab-hardening/cdp-lib.mjs`）。プレビュー webview 内は `scripts/frame.mjs` で iframe ターゲットの実行コンテキストへ評価

## 実測値

| 観測 | 記録 | 結果 |
|---|---|---|
| 自作 SFX を ＋ | `plus-sfx-assets-diff.txt` / `plus-sfx-ledger.json` / `plus-sfx-edit-diff.txt` / `project-panel-reference.json` / `after-plus-sfx.png` | `assets/` の差分なし。台帳に `{audio, ref-beep}` が 1 行。edit.json は `assets/audio/ref-beep/ref-beep.wav`。プロジェクト面に「参照」の札 |
| 参照 SFX の波形 | `timeline-waveform-reference.json` / `.png` | A1 のクリップに波形 canvas（452×52・非透明 14,464 px）。同じ wav をプロジェクト実体で置いた対照と同じ画素数 |
| 参照 SFX がプレビューで鳴る | `preview-audio-reference.json` | 再生で `AudioBufferSourceNode.start` に 1.5 秒・モノラルのバッファ。配信 URL の中身の sha256 が置き場の wav と一致（`8c21bd1d…`）。プロジェクトに実体は無い状態で確認 |
| B-roll を「使う」 | `use-broll-ledger.json` | `assets/` 差分なし・台帳に `{broll, ref-broll}` |
| B-roll / 静止画を ＋ | `plus-still-edit-diff.txt` | edit.json の sources に `assets/broll/ref-broll/ref-broll.mp4` / `assets/still/ref-still/ref-still.png`。`assets/` に実体なし |
| 静止画がプレビューに映る・サムネ | `preview-still-t0.png` / `preview-still-and-timeline-thumbnails.png` | t=0 で橙の静止画。V3 に静止画サムネ、V2 に B-roll のフィルムストリップ（`timeline-filmstrip.json`） |
| B-roll がプレビューに映る | `preview-broll.png` | t=7 で testsrc2 の画。**codex 3 往復目の修正後**（修正前は `Frame engine: Failed to fetch`。実体コピーの対照では映ったので参照経路固有と特定して差し戻した） |
| プロジェクト面の 3 枚 | `project-panel-three-references.json` / `.png` | audio / broll / still が「参照」の札つき。broll / still はサムネあり |
| Cmd+Z | `undo-still.txt` | 静止画の ＋ を 1 手で戻す（edit.json が直前コミットと一致）。台帳の行は残る |
| 退避 → 見つかりません | `missing-after-evacuate.json` / `.png` | `library/broll/ref-broll` を退避し、プロジェクト面の再読み込み後に「見つかりません」「入れ直してください」（own のため）。※置き場側の変更だけでは自動で再読み込みされなかった（下記） |
| 退避中の書き出し | `render-missing.log` | render-cut が exit 2 で停止: `ffprobe failed for ref-broll.mp4: …/assets/broll/ref-broll/ref-broll.mp4: No such file or directory` |
| 戻すと直る | `restored.json` | 戻して再読み込み後、3 枚とも missing なし |
| 右クリック | `reference-context-menu.json` / `.png` | 参照カードは `view-library:ライブラリで見る` / `remove-reference:このプロジェクトから外す` の 2 つだけ |
| 外す（使用中） | `remove-reference-warning.json` / `.png` | 「edit.json / captions.json から 1 箇所参照されています」の確認。キャンセルで台帳は不変 |
| 素材をまとめる | `bundle-dry-run-dialog.json` / `.png` → `bundle-result.json` / `bundle-after-files.txt` / `bundle-after.png` | 実行前に「3 件・1.69 MB を集めます。再配布できない素材が 3 件含まれます」。実行後 `assets/<category>/<id>/` に実体・台帳は空・参照カード 0 枚 |
| 2 回目 | `bundle-second-run.json` | 「実体化する参照はありません」、assets の mtime も不変 |
| Lab の「使う」/ ＋ | `lab-use-sfx.txt` / `lab-plus-sfx-edit-diff.txt` | 置き場に `sfx-bell-tree.mp3` が入り、プロジェクトの `assets/` は不変・台帳に 1 行。＋ で edit.json に `assets/audio/sfx-bell-tree/sfx-bell-tree.mp3` |
| 書き出しの参照の表 | `render-media-references-3refs.json` / `render-media-references-lab-sfx.json` / `render-run-status.txt` | render-cut が参照 3 本（と Lab SFX）を置き場の絶対パス + `library_root` へ解決。GPU の run.json は `completed 298/298` |

## 未達・申し送り

- **書き出しの最終段が終わらない（環境）**: render-cut の GPU / OSR いずれも 298/298 フレームを描き `run.json` は `completed` になるが、Electron が終了せず（CPU 時間 0:03 のまま・`RN`）render-cut が戻らない。**参照を含まないコピー時代の対照プロジェクトでも同じ**。この間の load average は 150〜600。mp4 と `render.json`（`scope: "library"` の記録）は得られていない
- 置き場側（ライブラリ）のファイル変化だけでは参照カードが自動更新されなかった。プロジェクト内のファイル変化で再読み込みすると正しく出る。疑い: 疑似環境の `/tmp` → `/private/tmp` のシンボリックリンクで監視イベントのパスと比較先がずれている（未確認）
- 「外す」の確認文が「このプロジェクトから外すしますか？」と動詞が重なる（既存の確認テンプレートに操作名を差し込んでいるため）
- ドラッグでの配置は L1 で操作していない（＋と「使う」だけ）
