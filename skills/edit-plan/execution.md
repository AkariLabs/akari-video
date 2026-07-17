# 承認後の実行

## 原則

このファイルは Checkpoint 3 の明示承認後だけ読む。承認された manifest を M1〜M4 の `edit.json v0` と authoring 規約へ忠実に変換し、表現できない計画を独自フィールドで補わない。

## 1. 単一 source を確定する

`edit.json v0` の `source` は 1 本だけである。複数映像が最終構成に必要なら、実行承認前に少なくとも次を両論併記し、人間の選択を `decision_log` に追記する。

- **主素材 1 本へ限定**: v0 の編集可能性を保つが、他素材の映像は計画のみ、または overlay で表せる静止物に限定される。
- **単一中間マスターへ conform**: 承認済み順序と区間を ffmpeg で 1 本にし、そのファイルを source にする。複数素材を使える一方、元素材別の keep-range 編集性が下がる。素材・source 時刻・master 時刻の対応表はレポートに残す。
- **実行を止める**: multi-source 対応 Schema まで待ち、v0 成果物を作らない。

素材別に独立した v0 を作る案が要件を満たす場合は併記してよい。黙って concat したり、`sources[]`、`source_id`、独自 track を追加したりしない。

BGM、SFX、動画 B ロールも v0 に専用 field がない。承認済み中間マスターへ焼き込むか、計画のみとして未実行にするかを manifest で区別する。

## 2. edit.json v0 を作る

承認値を次の形へ入れる。例の数値を既定値として流用しない。

```json
{
  "version": 0,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "source": {
    "path": "source/master.mp4",
    "proxy": "source/master-proxy.mp4"
  },
  "cuts": [
    { "in": 5.0, "out": 10.0 }
  ],
  "overlays": [
    {
      "id": "chapter-setup",
      "html": "overlays/chapter-setup.html",
      "start": 1.0,
      "duration": 4.0,
      "transform": { "x": 0, "y": -80, "scale": 1, "rotate": 0 },
      "vars": { "--color": "#ffffff" }
    }
  ]
}
```

- `source.path` は原本または承認済み中間マスター、`source.proxy` は対応する 720p preview。原本を proxy へ置き換えない。
- path は `edit.json` からの相対または絶対。可搬性のため同一ツリーでは相対を使う。
- `cuts` は source 秒の keep-range で昇順・非重複。空配列は source 全体を使う。
- `overlays.start` は cut 連結後の timeline 秒。source 秒の event をそのまま入れない。
- overlay ID は一意、HTML path は存在し、`duration > 0` とする。

source 時刻 `s` が keep-range `[in, out]` にあるとき、timeline 時刻は「それ以前の keep-range 長の合計 + `(s - in)`」で求める。境界にある overlay は実フレームを確認し、カットで消える区間へ置かない。

## 3. オーバーレイ HTML を作る

最初に [overlay-authoring](../overlay-authoring/SKILL.md) を読み、必要なリーフだけを追加で読む。利用不能なら [CLAUDE.md の authoring 規約](../../CLAUDE.md) を読み、fallback を `decision_log` に追記する。

- 断片のルート要素は 1 個にする。
- 調整可能な値を `--x`、`--y`、`--scale`、`--font-size`、`--color` 等の CSS 変数にする。
- `edit.json.overlays[].start/duration` を SSOT とし、ランタイム所有の外側コンテナに反映される `data-start` / `data-duration` と一致させる。断片内に独立した時刻源を作らない。
- アニメーションは transform / opacity 中心にし、4K 映像上の `filter: blur()` と `backdrop-filter` を使わない。
- wall-clock に依存せず、シーク時に Web Animations API の `currentTime` で同じ絵を再現できるようにする。
- 3D が必要なら Three.js + glTF、動画 texture は proxy を使う。
- transcript 等の可変文字列を HTML と CSS の文脈に合わせて escape する。

サムネ用の HTML 文字組を、タイミング付き動画 overlay として無条件に再利用しない。

## 4. 検証してレポートを閉じる

- [edit-lint](../edit-lint/SKILL.md) を実行し、`edit.json` の構造、cuts 整合、参照解決、
  overlay の timeline 時刻・ID・HTML root・data 属性が PASS になるまで findings を修正する。
- overlay の CSS 変数と禁止 CSS は overlay-authoring 規約に照らして確認する。
- 中間マスターを作った場合は、素材別対応表と実フレームで境界を確認する。
- `editing-report.html` の checkpoint 状態を実際の承認に合わせ、実行結果と provenance を追記する。過去の log 行は変更しない。

## よくある間違い

- 複数素材のために契約外の `sources` や track を追加する。
- 素材計画にある BGM / SFX field を v0 に発明する。
- `cuts` と overlay の時刻をどちらも source 秒で書く。
- 実行承認前に中間マスターや overlay を作る。
- authoring skill がないことを理由に規約を省略する。
- edit.json の sample 値を、承認されていない出力仕様として使う。
