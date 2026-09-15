---
name: design-world
description: 「ワールドを作って」「地図で見せる動画」「紙からブラウザの中へ入っていく映像」など、複数の世界と停留所を連続カメラで結ぶ flat ワールドを設計・検査・組み立てるときに使う。
---

# Design World

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

## ハードルール

- ワールド操作は `akari world check|build|preview|overview` のサブコマンドだけで行う。リポジトリ内の実装ファイルを直接呼ばない。
- 正本は `planning/world-map.json`。生成物だけを既存の visual track に置き、`edit.json` の語彙を増やさない。
- `planning/world-map.json` は `expand-template.mjs` に作らせ、手でキーを足さない。world runtime は許可キー以外を拒否する。
- v0 は `kind: flat` だけを対象にする。`spatial` は設計も build もしない。
- 座標は台本とテンプレートの layout から決める。既存作品の座標を写さない。
- 同じ world 内は `move`。世界をまたぐ既定は `portal`。`cut` を選ぶときは `transition.kind: mist` とする。
- 世界をまたぐすべての辺に空でない `carry` を置き、その全要素を `retainedNodes` に含める。
- 各 world には停留所を 2 件以上置く。zones と cameraStops の id は一致させる。
- `edit.json` には**ベース映像**が要る（`sources` 1 件 + visual トラックにベースの item 1 件）。無いと `render-cut` が落ちる。ワールドの overlay だけでは書き出せない。

## 最初に聞く 3 問

1. 世界はいくつで、紙・ブラウザ・街・部屋など何の世界ですか。
2. 各世界で見せたい停留所は何ですか。
3. 世界をまたいで持ち越す物は何ですか。

## 手順

0. プロジェクトと 15 秒の無地ベースを用意する。手持ち映像を使う場合も `sources` と visual item の両方へ登録する。

   ```sh
   PROJECT=<project>
   SKILL_DIR=<このスキルのディレクトリの絶対パス>
   mkdir -p "$PROJECT/planning" "$PROJECT/sources"
   ffmpeg -y -f lavfi -i "color=c=#101418:s=1920x1080:r=30:d=15" \
     -pix_fmt yuv420p "$PROJECT/sources/base.mp4"
   ```

   `$PROJECT/edit.json` は次の v2 骨格にする。15 秒 × 30 fps なので `duration` は 450 フレーム。`akari world build` は id `world` の visual item を追加または更新する。ベース item と時間が重なるため、既存とは別の visual トラックに置かれる。

   ```json
   {
     "version": 2,
     "output": { "width": 1920, "height": 1080, "fps": 30 },
     "sources": [{ "id": "base", "path": "sources/base.mp4" }],
     "tracks": [
       { "id": "v1", "lane": "visual", "items": [
         { "id": "base", "at": 0, "duration": 450, "source": { "kind": "media", "src": "base", "in": 0, "out": 15 } }
       ] }
     ]
   }
   ```

1. `$SKILL_DIR/templates/` から構成を選ぶ。紙から画面へ入るなら `paper-to-browser`、ブラウザから会話へ渡すなら `browser-to-chat`、歩いて室内へ着くなら `street-to-room`。
2. 選んだ JSON の `sampleScript` を `$PROJECT/planning/script.json` に写す。停留所の `label`、`dwell`（秒）、`asset`、world ごとの上書き、`carry` をブリーフに合わせて変更する。総尺は `Σ dwell + Σ 辺の尺` で求める。辺の尺は `move` 0.75 秒、`portal` 1.2 秒、`cut` 0.8 秒。`script.worlds.<worldId>.label` で表示名、`.palette` で `background` / `dots` / `accent` / `haze` を上書きできる。world id と stop id は内部キーなので、表示名は `label` で言い換えてよい。各 world の stop 数と内部 id は変えない。
3. 台本をスキル側へ置かず、次の形で展開する。

   ```sh
   PROJECT=<project>
   SKILL_DIR=<このスキルのディレクトリの絶対パス>
   node "$SKILL_DIR/bin/expand-template.mjs" \
     "$SKILL_DIR/templates/paper-to-browser.json" \
     "$PROJECT/planning/script.json" \
     --out "$PROJECT/planning/world-map.json"
   ```

   expand は最初の build を可能にするため、portal に 0.18 秒、cut に 0.24 秒の**有限の暫定値**を `cover` として入れる。テンプレートの `edges[].cover` でも 0〜0.4 秒の範囲で上書きできるが、最終的には preview の実測値を正とする。
4. `akari world check "$PROJECT"` を実行し、エラーが 0 件になるまで台本を直して再展開する。
5. 素材は、世界観の束（例: Pop Motion ワールド対応版）が持つ **背景 / 飛び込み口 / モチーフ** の 3 層で考える。背景で world ごとの材質を作り、飛び込み口で portal の通過を読ませ、モチーフを各停留所へ置く。必要な素材は `akari assets fetch <id>` で取得でき、`akari world build` がプロジェクト内の素材を解決する。
6. `planning/world-items.json` を作り、素材を zone に対応づける。`asset` は必ず `overlay/<id>` と書く。`offset`、`scale`、`vars` は任意。

   ```json
   {
     "schemaVersion": 1,
     "items": [
       {
         "id": "arrival-motif",
         "zone": "paper-note",
         "asset": "overlay/<使う素材の id>",
         "offset": [-240, -180],
         "scale": 0.85,
         "vars": { "accent": "#4285f4" }
       }
     ]
   }
   ```

   `asset` の `<使う素材の id>` は実際に使う素材の id に置き換え、`zone` は `planning/world-map.json` の zone id と一致させる。同じ zone の items は配列順に重なり、後ろの item が上に乗る。素材ごとに基準点と既定サイズが異なるため、`meta.json` / `fragment.html` を実測して `offset` を決める。詳しくは [world.md の「構図の目安」](world.md#構図の目安) を見る。
7. `akari world build "$PROJECT"` を実行する。`overlays/world.html` と `edit.json` の world item が生成される。
8. `akari world preview "$PROJECT" --measure` を実行して `planning/world-map.json` の cover を実測値へ置き換える。生成済みの `overlays/world.html` は暫定値のままなので、`akari world build "$PROJECT"` をもう一度実行し、`akari world check "$PROJECT" --strict` を通す。順番は **build → preview --measure → build → check --strict**。
9. `akari world overview "$PROJECT"` を実行し、実素材が同じ時刻で並ぶ俯瞰地図を人に見せる。停留所の順、世界境界、carry、portal/cut の位置が意図どおりか確認する。

判断に迷ったら [world.md](world.md) の型を使う。概念と地図タブの読み方は [guide.md](guide.md) を見る。
