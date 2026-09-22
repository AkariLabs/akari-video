# 自分で入れた素材をライブラリ面に出す・出どころの切り替え・「最近入れた」の帯 — L1 証跡

## 採取方法

- 開発ビルド（`apps/shell` で `npm run build`）の Electron を直接起動。CDP ポート 9412。
  `AKARI_HOME` / `AKARI_LIBRARY_ROOT` / `AKARI_CREATOR_ROOT` / `THEIA_CONFIG_DIR` / `--user-data-dir` はすべて `/tmp/loav-l1/` 配下（実機の `~/.akari`・`~/Akari` は不使用）
- 置き場の素材は本物の CLI（`akari-assets add --plan` → `--apply`）で入れた。順に
  1. フォルダ `FieldRec/`（2 秒のノイズ 3 本 → `origin:own`・`folder:FieldRec`・`sfx`）
  2. `site-bgm-morning.mp3`（40 秒。plan に `origin: site`・`site: dova-syndrome`・`sourceUrl`・`licenseAtSource` を指定 → `source.url` 付き）
  3. `own-click.wav`（1.5 秒 → `origin:own`・`sfx`）
- プロジェクトは `templates/project-default` の複製 + 6 秒の `assets/base.mp4` + 映像 1 行（cut-1 / cut-2）+ A1。git 管理して差分を見た
- 操作は実マウスクリック（`scripts/probe.mjs`）。トランジションの D&D は `../library-direct-place/scripts/transdrag.mjs`
- オフライン: `AKARI_ASSETS_CATALOG=http://127.0.0.1:9/catalog.json`（接続拒否）で起動し直し、`catalog-cache.json` も退避して取得不能にした

## 実測値

| 観測 | 記録 | 結果 |
|---|---|---|
| ホーム（全部） | `home-all.json` / `home-all.png` | BGM 122・SFX 100 ほか。帯 = own-click → site-bgm-morning → FieldRec（3 件が 1 個・「SFX · 3 件」） |
| 「自分の」 | `home-own.json` / `home-own.png` | SFX = 4 だけ残り、ほかは 0 で opacity 0.46。プリセット・トランジションも 0。帯は own-click と FieldRec |
| 「素材サイト」 / 「Lab」 | `home-site.json` / `home-lab.json` | 素材サイト: BGM 11（外部索引 10 + site-bgm-morning）・SFX 19・フォント 31・パック 2。Lab: BGM 111・SFX 77・テキストスタイル 12・トランジション 29 |
| カテゴリの中で切り替え | `cat-sfx-own.json` → `cat-sfx-site.json` → `cat-sfx-all.json` | 自分の = field-birds / field-rain / field-wind / own-click の 4 枚、素材サイト 19 枚、全部 100 枚 |
| 戻っても状態を保つ | `home-after-back-own.json` | カテゴリで「自分の」→ ← ライブラリでホームへ: `own:true` のまま・件数も自分のもの |
| 帯のフォルダ | `strip-folder.json` / `strip-folder.png` | SFX が開き、フォルダ絞り込み `FieldRec`、カードは field-* の 3 枚だけ |
| 帯の個別素材 | `strip-own-click.json` / `strip-own-click.png` | SFX が開き、own-click のカードまでスクロールしてハイライト |
| 試聴（自作 SFX） | `audition-own-click.json` | `file:///tmp/loav-l1/library/audio/own-click/own-click.wav` を再生し終わり（currentTime 1.5 = 全長・readyState 4・error なし） |
| 試聴（素材サイトの BGM） | `audition-site-bgm.json` | `file:///…/site-bgm-morning.mp3` 再生中（2.29 秒・paused=false）、カードが playing |
| ＋（素材サイトの BGM、プレイヘッド 0） | `plus-site-bgm.json` / `after-plus-site-bgm.png` | `audio.sfx[]` に `assets/audio/site-bgm-morning/site-bgm-morning.mp3` t=0。プロジェクトに meta.json / preview.png / mp3 が複製。A1 にクリップ表示 |
| ＋（自作 SFX、プレイヘッド 00:00:02.091） | `plus-own-click.json` / `after-plus-own-click.png` | `audio.sfx[]` に `assets/audio/own-click/own-click.wav` t=2.1。差分は `edit-diff-after-plus.txt` |
| オフライン | `offline-home-all.json` / `offline-home-own.json` / `offline-cat-sfx-own.json` / `offline-cat-bgm-site.json` / `offline-home.png` | カタログ外の 5 件は全部出る（SFX に own 4 枚、BGM（素材サイト）に site-bgm-morning）。※取得済み Lab 素材 `overlay/phone-2d` も own として帯に出る（下記） |

### 回帰（各 1 往復）

| 経路 | 記録 | 結果 |
|---|---|---|
| Lab 素材の「使う」 | `regression-lab-use.json` / `.txt` | `overlay/phone-2d`: available → cached。置き場とプロジェクトの `assets/overlay/phone-2d/`（demo.mp4 / fragment.html / meta.json / preview.png） |
| 購入導線 | `regression-purchase-before.json` / `-after.json` / `regression-purchase.png` | `scene3d/app-icon-squircle`（locked・¥1,200）の購入ボタン = 「¥1,200 で購入 — ストアを開く（https://akari-oss.app/lab/asset.html?id=app-icon-squircle）」。押してもアプリ内のエラー・通知なし（ストアは外部ブラウザ） |
| パック棚 | `regression-pack-shelf.json` / `.png` | telop-standard（23 件）/ audio-standard（17 件）の 2 棚。「自分の」では 0 棚 |
| トランジションの D&D | `regression-transition-dnd.json` / `regression-transition-drag.png` | ドラッグ中に境界の受け皿（42×42・`data-akari-transition-drop-target=0-1`）が出る。ドロップ後 edit.json は不変 — `../library-direct-place/README.md` に記録済みの変更前（bb7c740e）と同じ挙動 |

## 申し送り

- オフライン時、`source.url` を持たない取得済み Lab 素材（例 `overlay/phone-2d`）は機械層の決定表で `own` になり、「自分の」と「最近入れた」に出る。シェルは `sourceKind` を決め直さない契約なので、直すなら機械層
