# カードを掴んだままパネルへ戻ると「取り込み」表示になる不具合 — L1 証跡（(2)）

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。`AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` は `/tmp/dfp-l1/`、CDP ポート 9423
  （cwd は `apps/shell`。cwd を /tmp にすると開発配置の asset-resolver が見つからずカタログがローカル分だけになる）。ウィンドウ 1120×668（CSS px）
- fixture: `material-drop-no-overlap` の fixture A（`v2` 空 / `v1` base.mp4 0〜180 / `a1` 空）を git 管理で複製
- 基点比較: 変更前のコミット `13d8784a` を `git archive` で `/tmp/dfp-base` に展開して同じ手順でビルドし、CDP 9424・`/tmp/dfp-bl1/` で起動（`baseline-*`）
- `scripts/paneldrag.mjs`: カードを **サムネイル `<img>` 自体がヒットする点**（`grip=img`。再生ボタン・バッジの被りを避けて探す）または
  カード下端（`grip=title`）から実マウスで掴み、`Input.setInterceptDrags` で本物の DragData を横取り → 素材パネルの中央（高さ 60%）で dragEnter / dragOver ×3 →
  パネルの外で dragOver してから dragCancel（`cancel`）またはパネル上で drop（`drop`）。ページ内の capture リスナーで dragstart / dragover の
  `dataTransfer.types` / `files.length` / `items` も記録（`pageDataTransfer`）
- **CDP の制約と補正**: `<img>` を掴んだ実ドラッグでは、dragstart のページ内 `dataTransfer` に `Files`（image/jpeg 1 件）が載るが、
  CDP が横取りする DragData にはファイル本体が入らない（`items` は `text/uri-list` / `text/html` / アプリ内 MIME だけ、`files: []`）。
  そこで dragstart に `Files` が見えたときは同じサムネイル画像を DragData.files に足して再送した（`injectedImageFile`）。これで dragover の types が
  `[text/uri-list, text/html, application/x-akari-library-item, Files]` になり、実ドラッグと同じ中身になる
- `FORCE_FILES=<path>`: 判定関数だけを見るため、`<img>` を経由せずアプリ内 MIME に OS ファイルを強制的に同乗させる
- `scripts/ospanel.mjs`: Finder からのファイル（DragData.files だけ）を素材パネルへ落とす

## 実測値

| 観測 | 記録 | 結果 |
|---|---|---|
| BEFORE: ライブラリ BGM カードをサムネイルから掴む | `before-lib-bgm-grip-img.json` / `before-lib-bgm-grip-img.png` | dragstart（target IMG）の types `[text/uri-list, text/html, Files]`・files 1・items に `file:image/jpeg`。パネル上の dragover types `[text/uri-list, text/html, application/x-akari-library-item, Files]` で **「ここに落とすと素材に取り込みます」が出る**。パネルの外へ出すと消える |
| BEFORE: 同カードをタイトル側から掴む | `before-lib-bgm-grip-title.json` / `before-lib-bgm-grip-title-2.json` | dragstart（target DIV）の types `[]`、dragover types `[application/x-akari-library-item]`。取り込みの枠は出ない |
| BEFORE（基点ビルド）: サムネイルから掴んでパネル上で離す | `baseline-lib-bgm-grip-img-drop-on-panel.json` | 枠が出て、**サムネイル画像が `assets/dragged-thumb.jpeg` として取り込まれる**（edit.json 不変） |
| BEFORE: プロジェクト面の素材カード（raw-clip.mp4 / bg-aurora-mesh） | `before-proj-video-grip-img.json` / `before-proj-video-grip-title.json` / `before-proj-still-grip-img.json` | **再現しない**。基点で既に `<img draggable="false">`（renderMaterialCard）。どこを掴んでも dragstart target は DIV、types `[application/x-akari-material]`、枠なし |
| AFTER: ライブラリ BGM をサムネイルから掴む（グリッド） | `after-lib-bgm-grip-img.json` / `after-lib-bgm-grip-img.png` | `<img draggable="false">`。dragstart target DIV・types `[]`、DragData `[application/x-akari-library-item]`・files `[]`。枠なし |
| AFTER: 同、パネル上で離す | `after-lib-bgm-grip-img-drop-on-panel.json` | 枠なし・取り込みなし（assetsAdded `[]`）・edit.json 不変 |
| AFTER: 同、タイトル側 | `after-lib-bgm-grip-title.json` | 枠なし |
| AFTER: リスト表示の行 | `after-listrow-img-draggable.json` / `after-listrow-grip-img-drop-on-panel.json` | 行の `<img>` 111 枚すべて draggable=false。サムネイルから掴んでパネル上で離しても枠なし・取り込みなし |
| AFTER: アプリ内 MIME + Files を強制（ライブラリ） | `after-lib-forced-files-hover.json` / `after-lib-forced-files-drop-on-panel.json` | dragover types `[application/x-akari-library-item, Files]` でも枠なし、パネル上の drop で取り込みなし |
| AFTER: アプリ内 MIME + Files を強制（プロジェクト面） | `after-proj-forced-files-drop-on-panel.json` | types `[application/x-akari-material, Files]` でも枠なし・取り込みなし |
| AFTER: サムネイルから掴んだライブラリ BGM をタイムライン A1 へ | `../../../akari-annotations/evidence/dnd-feedback-polish/f11-lib-bgm-thumb-grip-drop-a1.json` | 従来どおり置ける（`audio-1@111+4631`、Cmd+Z 1 回で byte 一致） |
| Finder からのファイル（プロジェクト面・ライブラリ面） | `after-finder-file-drop-on-panel.json` / `after-finder-file-drop-on-library-panel.json` / `after-finder-file-overlay*.png` | 取り込める（`assets/finder-photo*.jpeg`、トースト「1 件を素材に取り込みました。」）。**ドラッグ中の取り込みの枠は出ない** |
| 同、基点ビルド | `baseline-finder-file-drop-on-library-panel.json` / `baseline-finder-file-overlay-library-panel.png` | **基点でも同じ**（枠は出ず、取り込みはされる）。回帰ではない |

### Finder ドラッグで枠が出ない理由（基点からの挙動）

`akari-project-contribution.ts` の document capture `dragover` は、`Files` だけ（内部 MIME なし）のドラッグを委譲せず
`preventDefault` + `stopPropagation` で自分が受ける（issue #63 の委譲規約・`isDelegatedDropInput`）。そのためパネル自身の `handleDragOver` まで
dragover が届かず、`renderDropOverlay` は出ない。取り込み自体はグローバル経路の drop が行う。実測（ページ内 capture リスナー）:
dragenter / dragover の types `[Files]`・defaultPrevented true、パネルの枠要素なし。逆に言うと基点で枠が出るのは「内部 MIME があって委譲され、
しかも `Files` も載っている」= 本件の不具合ケースだけだった。

## スクリプト

`scripts/` — `paneldrag.mjs`（本票用）/ `ospanel.mjs`（本票用）/ `reload.mjs`（本票用）/ `cdp-lib.mjs`・`opencat.mjs`・`ev.mjs`・`click.mjs`・`mdrag.mjs`・`undo.mjs`
（`material-drop-no-overlap` の証跡スクリプトをポート 9423・`/tmp/dfp-l1` に変えて複製）。
