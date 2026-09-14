# ワールドマップ v0 契約

## 1. ファイルとスキーマ

ワールドマップはプロジェクトの `planning/world-map.json` に置く。このファイルの存在を地図 UI の表示条件とする。公開 v0 は `schemaVersion: 3` で、以後の変更は additive-only とする。旧 `schemaVersion: 2` は CLI の読み口で v3 に正規化できる。

共通のルートは `kind`、`worlds[]`、`zones[]`、`cameraStops[]`、`edges[]`、`retainedNodes[]` からなる。`kind` は `flat` または `spatial`。flat world は `flat.bounds` と `flat.pattern`、spatial world は `spatial.c` を持つ。zone は世界内の位置、cameraStop は滞在窓とカメラ位置、edge は連続する停留所間の移動または切替を宣言する。

機械検査する不変条件は次のとおり。

1. world は 1 件以上で、各 world は zone を 2 件以上持つ。
2. zones と cameraStops の id 集合は一致し、stop は `at` 昇順、`at < leave`、窓は非重複とする。
3. edge 数は stop 数より 1 少なく、順序と `from` / `to` / `t0` / `t1` が stop 列に一致する。
4. edge type は `move` / `portal` / `cut`。非 move は `via`、`transition`、区間内の `switchTime` が必須。
5. 世界をまたぐ edge は空でない `carry` を持ち、その値は `retainedNodes` の部分集合とする。
6. transition kind は `none` / `dive` / `mist` / `occluder` / `fade` / `push`。spatial では `push` を禁止する。
7. cut の実測 `cover` は 0.4 秒以下。未測定の `null` は通常検査では警告、strict 検査ではエラーとする。portal の cover には上限を設けない。
8. palette は 6 桁 hex、flat bounds と spatial floor size は有限かつ正とする。
9. 同一 world 内の連続 stop 間は move とする。

## 2. カメラ関数

`camera(t)` は world-map だけを入力にする純関数である。stop 窓では宣言値を返し、move では両 stop 間を補間する。portal / cut では `switchTime` より前を接近、後を脱出として `via` を経由し、切替時点で world を切り替える。同一入力時刻には常に同じ値を返す。

## 3. 描画

flat world は 1 個の overlay 断片で構成する。Canvas 層は背景、格子、遠景、portal、cut の覆いを描き、DOM sheet 層は素材と文字を持つ。各 world は直下の `.akari-world-sheet[data-world]`、zone はその子の `.akari-world-zone[data-zone]` とし、sheet 自身は left / top 0、zone の px は bounds 原点を引かない world 座標そのままとする。sheet の transform は authoring 時に固定せず、ランタイムが `camera(t)` から設定する。DOM と Canvas の混在出力は rasterize 経路を使う。

spatial world は three 断片で構成し、座標・床・背景・霧を宣言する。画面座標の 3D 小物は別 overlay item とする。

## 4. CLI

- `akari world check [--strict] [--migrate] [--json]`: スキーマと不変条件を検査し、必要なら v2 を v3 へ正規化する。
- `akari world build`: flat world の宣言、sheet、zone、解決済み素材断片を `overlays/world.html` に生成し、edit.json の `world` item を id 安定で upsert する。
- `akari world preview [--measure]`: stop と edge の代表時点を PNG と `camera-proof.json` にする。measure 時は非 move edge の完全被覆区間を 30 Hz で測り、該当する `transition.cover` だけを書き戻す。
- `akari world overview`: 外部通信を行わず `file://` で開ける自己完結の俯瞰 HTML を生成する。

同じ入力から得る HTML と画像は決定論的でなければならない。素材 id は asset resolver で解決し、未解決時は失敗として扱う。

## 5. 地図 UI

- 実装のマーカー判定は `akari-shell-strip` の ContextKey `akari.worldMap` に一元化する。
- main の「地図」タブは `akari-world-view` が担う。
- タイムラインのワールド帯と地図インスペクターは `akari-annotations` が担う。

地図 UI は world-map を読み取り専用で表示する。2D 俯瞰、ワールド帯、再生時刻に追従する撮影枠、選択中の stop / edge 詳細を提供し、データの編集機能は持たない。

## 6. 制作フロー

企画と絵コンテで章を world として宣言し、モーション区間は `world-map.json` → `akari world build` → overlay → 書き出しの順に処理する。実写区間との接点は portal とカットアウェイ章に限定する。

## 7. 将来拡張

生成動画を world の zone や edge へ配置する機能、world camera と別 overlay の 3D を世界座標で同期する機能、より大規模な world の間引きは v0 の外とし、後方互換な追加として導入する。
