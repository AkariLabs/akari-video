# L2 キーフレーム候補と視認

## 原則

L2 が明示要求されたときだけ読む。候補生成は `akari media filmstrip|grab`、所見は実画像の視認後にこのスキルが担う。コマンド仕様と画像上限は [`akari media` 契約 §1.1 / §2.2 / §2.3](../../docs/contract-2026-08-29-media-inspect-cli-v0.md) を正本とする。

## 1. 全体を粗く見る

既定の 12 コマで、まず 1 枚のコンタクトシートを得る。

```bash
akari media filmstrip "$SOURCE" --count 12
```

この段階で全体像が足りるなら、追加抽出しない。長尺を密に見る必要がある場合だけ `--every <sec>` を使い、候補総数を視認可能な範囲へ抑える。

| 素材長 | interval の初期目安 |
|---|---|
| 〜10 分 | 10 秒 |
| 10〜30 分 | 30〜60 秒 |
| 30 分〜 | 120 秒 |

```bash
akari media filmstrip "$SOURCE" --every 120
```

これは例示であり固定閾値ではない。変更した値と理由を報告する。

## 2. 画面変化が必要なときだけ scene 候補を足す

カット点、短いエラー画面、画面共有の切り替えなどを探す依頼では scene 検出を使う。

```bash
akari media filmstrip "$SOURCE" --scenes
```

候補が多すぎる場合だけ閾値を明示する。exit 1 は stderr の理由を報告し、内部ログや媒体バックエンドの終了コードをこのスキルで解釈し直さない。候補 0 件とコマンド失敗は stdout / exit の契約で区別する。

scene と interval の両方が常に必要なわけではない。依頼の根拠になる系統だけを実行する。

## 3. transcript 駆動の指定窓を足す

確定候補の highlight / hook など、発話時刻に対応する画が必要なら代表時刻を source 秒で `grab` する。全 transcript segment を機械的に画像化しない。

```bash
akari media grab "$SOURCE" -t 312 315.25 318.5
```

代表時刻は発話区間の中央を初期値とし、画面切り替えの狭間なら同じ event 区間内だけでずらして再取得する。区間外から取らない。

## 4. 候補を統合して採用画像を取り出す

各コマンドの stdout にある `times_s` を正とし、ファイル名や連番を秒とみなさない。scene / interval / transcript の候補を source 時刻順に統合し、同一時刻または視覚的に同じ隣接候補は実画像を比較して情報量の高い方へ寄せる。

採用時刻が決まったら、720p 高さの個別 PNG を安定した出力先へ取り出す。

```bash
akari media grab "$SOURCE" -t 12 315.25 --separate --out "$OUT_DIR/keyframes"
```

出力名と stdout の `times_s` の対応を控え、`keyframes[].t` を正本にする。採用元は `origin: "scene" | "interval" | "transcript"` で記録する。`grab` / `filmstrip` 自体は `note` を作らず、生成画像は `observations[]` へだけ追記される。

## 5. 画像を実際に視認する

最終ファイル一覧を確定してから、各画像を Read または利用中ハーネスの画像閲覧機能で開く。未視認画像へ `note` を書かない。各画像を開いた直後に、stdout の時刻とパスを照合して次を簡潔に記す。

- 人物・画面・資料などの主対象
- UI、スライド、タイトル、エラー表示などの可視状態
- 直前候補からの見た目上の変化
- 後工程の根拠になる構図、顔の有無、文字の可読性

音声内容や人物の意図を画像だけから推測しない。小さい UI 文字列は拡大確認し、準重複クラスタは note と画像を再突合する。全 note 記入後に `note[i]` と `path[i]` をもう一周照合する。

画像を開けない場合は note を捏造せず、別の時刻・出力形式で再取得する。それでも視認できなければ `keyframes: []` のまま劣化理由を報告する。L2 を要求されていない場合の `keyframes: []` も妥当であり、`observations[]` から未観察と区別する。

## 6. 人物情報への反映

顔 box は視認またはローカル検出で確認した時刻だけ記録し、`[x, y, width, height]` を 0〜1 の正規化座標にする。話者と顔の対応を確認できなければ `tracks.faces: []` のままにし、見た目だけで speaker を断定しない。

人物マットや詳細トラックは L2 で自動生成しない。L3 が明示要求されたときだけ必要なリーフを読む。

## よくある間違い

- L2 の要求がないのに全尺の scene / interval を走らせる。
- 連番やファイル名を source 秒だとみなす。
- コンタクトシートを開かず transcript だけから画像 note を作る。
- transcript の全 segment を無差別に grab する。
- 同じ絵を大量に keyframes へ残す。
- `grab` が自動で keyframe note を書くと思い込む。
