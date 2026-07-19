# evidence: timeline-display-v11（タイムライン表示強化 v1.1・Wave 17）

L1 検証（production ビルド + 生 CDP 実操作）の証跡。フィクスチャは実プロジェクトの複製
（実素材 26.3 秒・実文字起こし付き）を土台に、`edit.json` の `cuts` を 3 個・`overlays` を
2 個（1 個は既存 overlay と部分重複するよう追加）に加筆し、`captions.json` に完全に重複する
字幕 2 本（`c-ovl-a` / `c-ovl-b`、同一 start/end）を追加したもの。`captions.json` /
`review.json` は edit.json と同じ階層へ配置（既存の `akari-preview` 側の規約に合わせるため）。

検証環境: production ビルド（`npm run build`、0 errors）の Electron を隔離
user-data-dir + `--remote-debugging-port` で起動し、`playwright-core` の
`chromium.connectOverCDP` で実際の pointerdown/pointermove/pointerup・wheel（ctrlKey 付き）
イベントをディスパッチして操作した（座標はレンダリング後の DOM `getBoundingClientRect()` の
実測値）。

## スクリーンショット対応表

| ファイル | 内容 | 対応する受け入れ条件 |
|---|---|---|
| 01-open-default-bottom-panel.png | 起動直後、タイムラインが既定でプレビューと同じ下部パネルに開いている状態（クリップのサムネイル・字幕帯・オーバーレイ帯・注釈ピンも同時に見える） | L1-1（配置既定）/ L1-4 / L1-5 |
| 02-lanes-thumbnails-waveform-stacking.png | クリップ帯クローズアップ。C1/C2/C3 に実サムネイル + 波形（半透明バー）が重ねて表示され、字幕帯の右端で完全重複字幕 2 本がサブ行に分かれ、オーバーレイ帯で `subscribe-cta` / `lower-third-partial` が部分重複によりサブ行に分かれている | L1-2 / L1-4 / L1-5 |
| 03-overlapping-captions-two-rows-zoom.png | 完全重複字幕 2 本（`重複字幕A` / `重複字幕B`、同一 start/end）が縦に 2 段で描画されている拡大図 | L1-2 |
| 04-overlapping-caption-dragged-independently.png | 重複字幕 A・B をそれぞれ個別にドラッグした後の状態（下記 diff で片方のみ変化したことを確認済み） | L1-2 |
| 05-pinch-zoom-before.png | ピンチズーム前。ルーラーが 00:00〜00:26（全体表示）、プレイヘッドはクリックで選択した位置 | L1-3 |
| 06-pinch-zoom-after-fixed-point.png | `ctrlKey` 付き wheel イベントでズーム後。ルーラーが 00:02〜00:20 に縮小（ズームインを確認）、プレイヘッドの画面上の位置（%）はズーム前後で完全に同一（カーソル位置が不動点であることを確認） | L1-3 |
| 07-thumbnail-cache-regenerated.png | `cache/timeline/thumbs/` を削除した後、タイムラインを再表示するとサムネイルが再生成されて表示される | L1-4（キャッシュ再生成） |
| 08-open-via-command-palette.png | コマンドパレットから「タイムラインを開く」コマンドが検索・実行できる状態（メニューの `registerMenus` と同一のコマンド ID を実行する経路。メニュー登録先の裁定は下記「F28 の検証方法について」参照） | L1-1 |
| 09-ffmpeg-absent-placeholder-degrade.png | ffmpeg バイナリを一時的に無効化した環境で起動。クリップは色矩形のみ（サムネイル・波形なし）に劣化しつつ、字幕帯・オーバーレイ帯のスタッキング・クリップラベル等の表示機能は健全。フッター上に「ffmpeg が見つからないため、サムネイルと波形は表示されません（他の操作は通常どおり使えます）」の通知が出ている。この状態でクリップ右端トリムを実行し `edit.json` が正しく更新されることも確認済み（下記「非退行」節） | L1-6 |
| 10-nonregression-final-state.png | 5 種の非退行操作（トリム・並べ替え・字幕ずらし・Esc・undo）を通した後の最終状態。並べ替え後も各クリップの source 秒位置は不変（ラベルだけ再割当て）、字幕ドラッグにより新たに発生した重なり（`頑張っておりました` × `いい感じにかけてます`）も自動でサブ行に分かれている | L1-7（非退行）/ F29 の汎用性確認 |

## 実測 diff・実測値

### L1-1: 開く導線の常設（F28）

- 起動直後、`review.json` の初期存在検出により `AkariAnnotationsContribution.open()` が
  自動実行され、`{ area: 'bottom' }` でプレビューと同じ下部パネルに配置されることを確認
  （01-open-default-bottom-panel.png）。
- コマンド `タイムラインを開く`（`akari.annotations.open`）はコマンドパレットから検索・
  実行可能で、実行するとタイムラインパネルが復帰する（08-open-via-command-palette.png）。
- **メニュー登録先について**: 本拡張の境界外にある `akari-shell-strip` の
  `AkariMenuCuration`（`MAIN_MENU_BAR` を起動時に `File`/`Edit`/`Help` の 3 メニューへ
  刈り込む機構。ソースレビューで確認済み・ログ上でも
  `top-level menubar items AFTER curation: [File, Edit, Help]` を実機で確認）により
  **View 系メニューは実行時に存在しない**。よって `registerMenus` は `CommonMenus.FILE`
  に登録する設計とした（同拡張内 `akari-project` の `SHOW_AKARI_CHANGES` と同じパターン）。
  ネイティブ File メニューを実際にクリックする自動化（OS レベルの画面操作）は本セッションでは
  実施しておらず、コマンドパレット経由での同一コマンド実行 + ソースレビューで代替確認した
  （詳細は report.md の「未確認事項」）。

### L1-2: レーン内の段積み（F29）

- 完全重複字幕（`c-ovl-a`/`c-ovl-b`、共に `start:25.6, end:26.2`）が 2 つのサブ行
  （y 座標が 18px 差）に分かれて描画されることを DOM 実測で確認。
- 字幕 A のみをドラッグ（-0.64秒）:
  ```
  c-ovl-a: start 25.6→24.96, end 26.2→25.56, edited false→true
  c-ovl-b: 変化なし（start 25.6, end 26.2 のまま）
  ```
- 字幕 B のみをドラッグ（-0.196秒、重なりを維持する範囲）:
  ```
  c-ovl-b: start 25.6→25.404333073235986, end 26.2→26.004333073235983
  c-ovl-a: 変化なし
  ```
- オーバーレイ帯: 部分重複する `subscribe-cta`（0.5–25.8秒）と `lower-third-partial`
  （20–26秒）が別サブ行に分かれることを確認。
- 非退行操作中、字幕ドラッグにより新たに発生した重なり（`頑張っておりました` を
  5.89–8.95秒へ移動した結果 `いい感じにかけてます` 8.28–13.88秒と重複）も自動でサブ行に
  分かれることを確認（10-nonregression-final-state.png）— フィクスチャ固有ではなく
  アルゴリズムとして機能している。

### L1-3: ピンチズーム（F30）

- プレイヘッドを 30% 位置でクリック選択後、同じ画面座標で `ctrlKey` 付き wheel
  （`deltaY: -400`）をディスパッチ。
- ズーム前: ルーラー `00:00, 00:05, 00:10, 00:16, 00:21, 00:26`、プレイヘッド `left: 29.9769%`
- ズーム後: ルーラー `00:02, 00:06, 00:09, 00:13, 00:16, 00:20`（可視範囲が約27秒→約18秒に縮小
  = ズームインを確認）、プレイヘッド `left: 29.9769%`（**完全に同一** = カーソル位置が
  不動点であることを確認）

### L1-4/L1-5: クリップサムネイル・音声波形（F32/F33）

- クリップ C1/C2/C3 いずれも `background-image` に実際の ffmpeg 抽出フレーム
  （`data:image/jpeg;base64,...`）が設定されることを確認。
- 各クリップに 200×32 の内部解像度を持つ `<canvas>` が生成され、実音声から抽出した
  ピーク配列（`cache/timeline/waveform/*.json`、200 要素、最大振幅 0.236〜0.365・
  非ゼロサンプル 76〜126/200）を用いて描画されていることを確認。
- キャッシュは `cache/timeline/thumbs/*.jpg` と `cache/timeline/waveform/*.json` に生成され、
  `cache/.gitignore`（内容 `*`）が自動生成されて `cache/` 配下全体が git 管理対象外になる
  ことを確認（既存の auto-git コミット機構が誤ってキャッシュをコミットしないことを保証）。
- `cache/timeline/thumbs/` を削除した状態でタイムラインを再表示（コマンド実行）すると、
  同じハッシュのファイル名でサムネイルが再生成されることを確認
  （07-thumbnail-cache-regenerated.png）。
- **BGM 波形は実装対象外**: `edit.json` の現行スキーマ（`src/common/edit-store.ts` の
  `parseEdit`）には `audio`/`bgm` フィールドが存在せず、タスク契約の「audio 実装済みの
  場合のみ BGM 波形を描画する」に該当しないため、素材音声の波形のみを実装した。

### L1-6: ffmpeg 不在時の劣化

- `ffmpeg` バイナリを一時的にリネームして PATH 解決を不可能にした環境
  （`env PATH=...` によるディレクトリ除外だけでは Electron 側の PATH 復元機構により
  無効化できなかったため、バイナリ自体を検証中のみ一時退避 → 検証直後に復元。復元済みを
  `ffmpeg -version` で確認済み）で起動。
- クリップは色矩形のみ（サムネイル・波形なし）に劣化し、フッターに
  「ffmpeg が見つからないため、サムネイルと波形は表示されません（他の操作は通常どおり
  使えます）」の通知が 1 回だけ表示されることを確認。
- この状態でクリップ右端トリム操作を実行し、`edit.json` の `cuts[].out` が正しく更新される
  ことを確認（操作機能が生きていることの確認）。

### L1-7: 非退行（5 種 + α）

| 操作 | 実測結果 |
|---|---|
| クリップ端トリム | `cuts[1]`: `in 7.690022123893805→7.94`、他は不変 |
| クリップ並べ替え | `[C1,C2,C3]` → `[C3,C1,C2]`（配列順のみ変化・各要素の in/out 値は不変。ラベルは配列順に再割当てされ視覚位置は各クリップの秒位置のまま不変 — 16a と同じ設計） |
| 字幕ドラッグ | `c-0002`: `start 5.22→5.89, end 8.28→8.95`（同delta）、他の字幕は不変 |
| Esc キャンセル | ドラッグ中に Esc → ゴースト要素が 1→0 に消滅、`edit.json` の MD5 がドラッグ前後で完全一致（無変化） |
| undo | オーバーレイ移動（`start 0.5→1`）後に「元に戻す」をクリック → `start` が `0.5` に復元 |
| クリックシーク | クリックで再生位置を選択 → フッターに「00:00:11.703 を選択しました。プレビューを開くとここからジャンプできます。」と表示（v0 の 3 分岐のうち「プレビュー未オープン」分岐。動画プレビューを開いた状態での確認は未実施 — report.md 参照） |

以上、L0（`build:ext`/`lint`/production build すべて exit 0・0 errors）と合わせて
`apps/shell/extensions/akari-annotations/**` の実装のみで受け入れ条件を満たすことを確認した。
