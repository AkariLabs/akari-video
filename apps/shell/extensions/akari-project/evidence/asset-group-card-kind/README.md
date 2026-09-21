# 素材グループカードの種別解決 — L1 証跡

## 何を直したか

ライブラリの「使う」で取り込んだ素材は `assets/<category>/<id>/`（meta.json 付きディレクトリ）に置かれ、
プロジェクト面では 1 枚のグループカードになる。従来このカードは `kind: 'other'` 固定だったため、
ドラッグも右クリックの「タイムラインに追加」もできなかった。

`src/common/asset-group-media.ts` の純関数 `resolveAssetGroupMedia` が meta.category と直下の子一覧から
主メディアを 1 本に決め（audio → 音声 1 本 / broll → 動画 1 本 / still → HTML なし・preview.png を除く画像 1 本）、
そのときだけ kind を `audio` / `video` / `image` にする。ドラッグ payload と「タイムラインに追加」には
ディレクトリではなく主メディアファイルの相対パスを渡す。カードの見た目（タイトル・preview.png サムネ・
カテゴリバッジ・文字起こしバッジ無し）とクリック先は変えていない。

## 採取方法

- Electron を `AKARI_HOME` / `THEIA_CONFIG_DIR` / `--user-data-dir` を一時ディレクトリへ向けて直接起動し、raw CDP で操作した
- fixture: `templates/project-default` の複製 + 6 秒の base.mp4 を V1 に置いた edit.json（V1 映像・A1 空の音）+ OS から置いた想定の生ファイル `assets/video/raw-clip.mp4`
- 「使う」: ライブラリ面の実ボタン（`data-akari-catalog-action=use`）をクリックして取り込んだ
  - B-roll `talkinghead-desk-ja-01`（clip.mp4 / voice.wav / still.png / preview.png / meta.json ほか）
  - BGM `bgm-jazzhop-piano-086`（現行カタログの音源は meta.json を持たないため、mp3 単体のファイルカードになる）
- meta.json を持つ音源グループは現行カタログに無いため、旧カタログ版で取得済みのライブラリ実物（`~/.akari/assets/`）を
  `copyIntoProject` と同じ配置で複製した: `dova-syndrome-cheerleaders-bgm`（mp3 1 本）/ `maoudamashii-bgm-piano`（mp3 2 本）/
  still `br-3d-printer`（fragment.html 入り）/ scene3d `app-icon-squircle`（demo.mp4 入り）/ overlay `lower-third-clean`（リポの assets/ から）
- ドラッグは `Input.setInterceptDrags` で本物の dragstart の DragData を横取りし、`Input.dispatchDragEvent` の dragEnter → dragOver → drop でタイムラインへ落とした
- 戻しは実キーイベントの Cmd+Z 1 回
- スクリプトは `scripts/`（state / drag / menu / undo / ph）

## 実測値

| 観測 | BEFORE | AFTER |
|---|---|---|
| broll `talkinghead-desk-ja-01` の draggable | false | true |
| broll の右クリック「タイムラインに追加」 | なし | あり |
| 音源グループ `dova-syndrome-cheerleaders-bgm` の draggable / 追加 | false / なし | true / あり |
| 「使う」の BGM `bgm-jazzhop-piano-086.mp3`（ファイルカード） | true / あり | true / あり |
| 音源パック `maoudamashii-bgm-piano`（mp3 2 本） | false / なし | false / なし |
| still（HTML）/ scene3d / overlay | false / なし | false / なし |
| 生ファイル `raw-clip.mp4` | true / あり | true / あり |

ドロップ（`after-drop-*.json`・`after-undo-*.json`）:

| カード | payload.relativePath | 置かれた先 | Cmd+Z |
|---|---|---|---|
| broll | `assets/broll/talkinghead-desk-ja-01/clip.mp4`（video） | V1 に item（at 197・37.6 秒） | items 2 → 1、edit.json はコミット時と一致 |
| 音源グループ | `assets/audio/dova-syndrome-cheerleaders-bgm/Cheerleaders.mp3`（audio） | A1 に item（at 136・30.14 秒） | items 2 → 1 |
| 「使う」の BGM | `assets/audio/bgm-jazzhop-piano-086/bgm-jazzhop-piano-086.mp3`（audio） | A1 に item（at 136・154.36 秒） | items 2 → 1 |
| 生ファイル（回帰） | `assets/video/raw-clip.mp4`（video） | V1 に item（at 203・4 秒） | items 2 → 1 |
| still / scene3d / overlay / 音源パック | — | dragIntercepted なし・edit.json 不変 | — |

右クリック「タイムラインに追加」（`after-menu-add-*.json`、再生ヘッド 00:00:04.667 = 140 フレーム）:

| カード | 書き込み | Cmd+Z |
|---|---|---|
| broll | V1 に item `clip-1` at 140 | 元に戻る |
| 生ファイル（比較） | V1 に item `clip-1` at 140 | 元に戻る |
| 音源グループ | `audio.sfx[]` に t = 4.667 | 元に戻る |
| 音源ファイル（比較） | `audio.sfx[]` に t = 4.667 | 元に戻る |

音声を再生ヘッドへ追加すると `audio.sfx[]` に入るのは受け側の既存挙動で、生の音声ファイルと同じ。

## 未観測

- font カテゴリのグループカードは fixture に置けなかった（リポの `assets/font/*` は meta.json を持たない。`catalog/font` は取得先の索引のみ）。font が `other` のままになることは単体テストで確認している
